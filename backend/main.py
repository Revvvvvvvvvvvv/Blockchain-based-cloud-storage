from fastapi import FastAPI, UploadFile, HTTPException, File, Form
from fastapi.responses import FileResponse
from typing import List
import shutil
import os
from pathlib import Path
from Crypto.Cipher import AES
from Crypto.Random import get_random_bytes
from Crypto.Protocol.KDF import PBKDF2
import json
from contextlib import asynccontextmanager
from pyuploadcare import Uploadcare
from dotenv import load_dotenv
import requests  # Add this import at the top
from fastapi.middleware.cors import CORSMiddleware  # Add this import

load_dotenv()

# Constants
CHUNK_SIZE = 45307
AES_KEY_SIZE = 32
SALT_SIZE = 16

# Temporary directories
UPLOAD_DIR = Path("temp_uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

ENCRYPTED_DIR = Path("temp_encrypted")
ENCRYPTED_DIR.mkdir(exist_ok=True)

DECRYPTED_DIR = Path("temp_decrypted")
DECRYPTED_DIR.mkdir(exist_ok=True)

# Initialize Uploadcare client
uploadcare = Uploadcare(
    public_key=os.getenv('UPLOADCARE_PUBLIC_KEY'),
    secret_key=os.getenv('UPLOADCARE_SECRET_KEY')
)

def get_aes_key(password: str, salt: bytes) -> bytes:
    return PBKDF2(password, salt, dkLen=AES_KEY_SIZE)

def split_file(file_path: Path) -> List[bytes]:
    with open(file_path, 'rb') as file:
        parts = []
        while chunk := file.read(CHUNK_SIZE):
            parts.append(chunk)
    return parts

def encrypt_chunk(chunk: bytes, key: bytes) -> tuple:
    cipher = AES.new(key, AES.MODE_EAX)
    ciphertext, tag = cipher.encrypt_and_digest(chunk)
    return cipher.nonce, tag, ciphertext

def decrypt_chunk(nonce: bytes, tag: bytes, ciphertext: bytes, key: bytes) -> bytes:
    cipher = AES.new(key, AES.MODE_EAX, nonce=nonce)
    return cipher.decrypt_and_verify(ciphertext, tag)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create directories if they don't exist
    for dir_path in [UPLOAD_DIR, ENCRYPTED_DIR, DECRYPTED_DIR]:
        dir_path.mkdir(exist_ok=True)
    yield
    # Only clean temporary upload and decrypted files, keep encrypted metadata
    for dir_path in [UPLOAD_DIR, DECRYPTED_DIR]:
        if dir_path.exists():
            shutil.rmtree(dir_path)
            dir_path.mkdir()

app = FastAPI(title="File Encryption Service", lifespan=lifespan)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Add your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"]
)

@app.post("/encrypt/")
async def encrypt_file(file: UploadFile = File(...), password: str = Form(...)):
    try:
        temp_file_path = UPLOAD_DIR / file.filename
        with open(temp_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        salt = get_random_bytes(SALT_SIZE)
        key = get_aes_key(password, salt)
        chunks = split_file(temp_file_path)
        
        file_id = get_random_bytes(8).hex()
        encrypted_dir = ENCRYPTED_DIR / file_id
        encrypted_dir.mkdir(exist_ok=True)
        
        # Create a single encrypted file for Uploadcare
        encrypted_file_path = encrypted_dir / f"{file.filename}.encrypted"
        with open(encrypted_file_path, "wb") as f:
            for i, chunk in enumerate(chunks):
                nonce, tag, ciphertext = encrypt_chunk(chunk, key)
                # Write chunk metadata
                f.write(len(nonce).to_bytes(4, 'big'))
                f.write(len(tag).to_bytes(4, 'big'))
                f.write(len(ciphertext).to_bytes(4, 'big'))
                # Write chunk data
                f.write(nonce)
                f.write(tag)
                f.write(ciphertext)

        # Upload to Uploadcare
        with open(encrypted_file_path, "rb") as f:
            ucare_file = uploadcare.upload(f)

        metadata = {
            "original_filename": file.filename,
            "salt": salt.hex(),  # Include salt for blockchain
            "num_chunks": len(chunks),
            "uploadcare_file_id": ucare_file.uuid
        }
        with open(encrypted_dir / "metadata.json", "w") as f:
            json.dump(metadata, f)

        os.remove(temp_file_path)
        os.remove(encrypted_file_path)
        
        return {
            "message": "File encrypted and uploaded successfully",
            "file_id": file_id,
            "salt": salt.hex(),  # Include salt in response
            "num_chunks": len(chunks),
            "uploadcare_file_id": ucare_file.uuid,
            "uploadcare_url": ucare_file.cdn_url
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/decrypt/")
async def decrypt_file(file_id: str = Form(...), password: str = Form(...)):
    try:
        encrypted_dir = ENCRYPTED_DIR / file_id
        metadata_path = encrypted_dir / "metadata.json"
        
        if not metadata_path.exists():
            raise HTTPException(status_code=404, detail="Metadata not found for given file ID")
        
        # Load metadata
        with open(metadata_path, "r") as f:
            metadata = json.load(f)
        
        encrypted_file_url = f"https://ucarecdn.com/{metadata['uploadcare_file_id']}/"
        response = requests.get(encrypted_file_url)
        if response.status_code != 200:
            raise HTTPException(status_code=500, detail="Failed to download encrypted file")
        
        encrypted_file_path = encrypted_dir / f"{metadata['original_filename']}.encrypted"
        with open(encrypted_file_path, "wb") as f:
            f.write(response.content)
        
        salt = bytes.fromhex(metadata["salt"])
        key = get_aes_key(password, salt)
        
        decrypted_file_path = DECRYPTED_DIR / metadata["original_filename"]
        print (metadata["original_filename"])
        with open(encrypted_file_path, "rb") as ef, open(decrypted_file_path, "wb") as df:
            while ef.readable():
                nonce_size = int.from_bytes(ef.read(4), 'big')
                tag_size = int.from_bytes(ef.read(4), 'big')
                ciphertext_size = int.from_bytes(ef.read(4), 'big')
                
                if not (nonce_size and tag_size and ciphertext_size):
                    break
                
                nonce = ef.read(nonce_size)
                tag = ef.read(tag_size)
                ciphertext = ef.read(ciphertext_size)
                
                decrypted_chunk = decrypt_chunk(nonce, tag, ciphertext, key)
                df.write(decrypted_chunk)
        
        return FileResponse(decrypted_file_path, filename=metadata["original_filename"], media_type="application/octet-stream")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)