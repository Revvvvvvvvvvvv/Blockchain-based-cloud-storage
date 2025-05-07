import { useState, useEffect, ChangeEvent, FormEvent } from 'react'
import { ethers } from 'ethers'
import { Button } from "./components/ui/button"
import { Input } from "./components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs"
import { Alert, AlertDescription } from "./components/ui/alert"
import { ReloadIcon, FileIcon, LockClosedIcon, CopyIcon, CheckIcon } from "@radix-ui/react-icons"
import './App.css'

const CONTRACT_ADDRESS = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
const CONTRACT_ABI = [
  "function addFile(string fileId, string originalFilename, string salt, string uploadcareFileId, uint256 numChunks) public",
  "function getFile(string fileId) public returns (tuple(string fileId, address owner, string originalFilename, string salt, string uploadcareFileId, uint256 numChunks, uint256 timestamp))",
  "function getUserFiles() public view returns (string[] memory)"
]

interface FileMetadata {
  fileId: string;
  owner: string;
  originalFilename: string;
  salt: string;
  uploadcareFileId: string;
  numChunks: number;
  timestamp: number;
}

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [fileId, setFileId] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [copied, setCopied] = useState(false)
  const [selectedFileName, setSelectedFileName] = useState('')
  const [validationError, setValidationError] = useState('')
  const [contract, setContract] = useState<ethers.Contract | null>(null);
  const [account, setAccount] = useState('')
  const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

  useEffect(() => {
    const initContract = async () => {
      if (window.ethereum) {
        await window.ethereum.request({ method: 'eth_requestAccounts' })
        const provider = new ethers.providers.Web3Provider(window.ethereum)
        const signer = provider.getSigner()
        const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer)
        const account = await signer.getAddress()
        setContract(contract)
        setAccount(account)
      }
    }
    initContract()
  }, [])

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.size > MAX_FILE_SIZE) {
        setValidationError('File size should be less than 50MB')
        return
      }
      setFile(selectedFile)
      setSelectedFileName(selectedFile.name)
      setValidationError('')
    }
  }

  const copyFileId = () => {
    navigator.clipboard.writeText(fileId)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleEncrypt = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setValidationError('')
    
    if (!file) {
      setValidationError('Please select a file')
      return
    }
    if (!password) {
      setValidationError('Please enter a password')
      return
    }
    if (password.length < 8) {
      setValidationError('Password must be at least 8 characters')
      return
    }

    setLoading(true)
    setError('')
    setSuccess('')

    const formData = new FormData()
    formData.append('file', file)
    formData.append('password', password)

    try {
      const response = await fetch('http://localhost:8000/encrypt/', {
        method: 'POST',
        body: formData,
      })
      
      const data = await response.json()
      if (response.ok) {
        // Store metadata on blockchain
        const tx = await contract.addFile(
          data.file_id,
          file.name,
          data.salt,
          data.uploadcare_file_id,
          data.num_chunks
        )
        await tx.wait()
        setSuccess(`File encrypted! Your file ID is: ${data.file_id}`)
        setFileId(data.file_id)
      } else {
        setError(data.detail || 'Encryption failed')
      }
    } catch (error) {
      setError('Failed to process file')
    } finally {
      setLoading(false)
    }
  }

  const handleDecrypt = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!fileId || !password || !contract) return;

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      // Get file metadata from blockchain
      const metadata = await contract.getFile(fileId) as FileMetadata;
      
      const formData = new FormData()
      formData.append('file_id', fileId)
      formData.append('password', password)

      const response = await fetch('http://localhost:8000/decrypt/', {
        method: 'POST',
        body: formData,
      })
      
      if (response.ok) {
        // Handle file download
        //console.log(response)
        const disposition = response.headers.get('Content-Disposition')
        console.log(disposition)
  let filename = 'decrypted-file'

  if (disposition && disposition.includes('filename=')) {
    filename = disposition
      .split('filename=')[1]
      .split(';')[0]
      .replace(/['"]/g, '') // remove quotes
  }

  console.log('Received filename:', filename)
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        setSuccess('File decrypted successfully!')
      } else {
        const data = await response.json()
        setError(data.detail || 'Decryption failed')
      }
    } catch (error) {
      setError('Failed to decrypt file')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <Card className="w-[450px]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LockClosedIcon className="w-5 h-5" />
            File Encryption Service
          </CardTitle>
          <CardDescription>Securely encrypt and decrypt your files</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="encrypt" className="space-y-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="encrypt">Encrypt</TabsTrigger>
              <TabsTrigger value="decrypt">Decrypt</TabsTrigger>
            </TabsList>

            <TabsContent value="encrypt">
              <form onSubmit={handleEncrypt} className="space-y-4">
                <div className="space-y-2">
                  <Input
                    type="file"
                    onChange={handleFileChange}
                    className="cursor-pointer"
                    accept="*/*"
                  />
                  {selectedFileName && (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <FileIcon className="w-4 h-4" />
                      {selectedFileName}
                    </div>
                  )}
                </div>
                <Input
                  type="password"
                  placeholder="Enter encryption password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {password && (
                  <div className="h-1 w-full bg-gray-200 rounded">
                    <div 
                      className={`h-1 rounded transition-all ${
                        password.length < 8 ? 'w-1/3 bg-red-500' :
                        password.length < 12 ? 'w-2/3 bg-yellow-500' :
                        'w-full bg-green-500'
                      }`}
                    />
                  </div>
                )}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <ReloadIcon className="mr-2 h-4 w-4 animate-spin" />}
                  Encrypt File
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="decrypt">
              <form onSubmit={handleDecrypt} className="space-y-4">
                <div className="relative">
                  <Input
                    type="text"
                    placeholder="Enter file ID"
                    value={fileId}
                    onChange={(e) => setFileId(e.target.value)}
                  />
                  {fileId && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-2 top-1/2 -translate-y-1/2"
                      onClick={copyFileId}
                    >
                      {copied ? <CheckIcon className="w-4 h-4" /> : <CopyIcon className="w-4 h-4" />}
                    </Button>
                  )}
                </div>
                <Input
                  type="password"
                  placeholder="Enter decryption password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <ReloadIcon className="mr-2 h-4 w-4 animate-spin" />}
                  Decrypt File
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          {validationError && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{validationError}</AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          {success && (
            <Alert className="mt-4">
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default App