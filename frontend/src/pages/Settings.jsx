import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API } from '../App';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Alert, AlertDescription } from '../components/ui/alert';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Send,
  QrCode,
  CheckCircle,
  XCircle,
  Key,
  Cloud,
  Image as ImageIcon,
  Copy,
  ExternalLink,
  Settings as SettingsIcon,
} from 'lucide-react';

export default function Settings({ user, onLogout }) {
  const navigate = useNavigate();
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [qrCode, setQrCode] = useState(null);
  const [qrSessionId, setQrSessionId] = useState(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneSessionId, setPhoneSessionId] = useState(null);
  const [phoneCodeHash, setPhoneCodeHash] = useState(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [loading, setLoading] = useState(false);

  // API Keys
  const [cloudinaryName, setCloudinaryName] = useState('');
  const [cloudinaryKey, setCloudinaryKey] = useState('');
  const [cloudinarySecret, setCloudinarySecret] = useState('');
  const [imgbbKey, setImgbbKey] = useState('');
  const [workerUrl, setWorkerUrl] = useState('');

  // Bot Token
  const [botToken, setBotToken] = useState('');
  const [botUsername, setBotUsername] = useState('');

  // Manual Channel ID
  const [manualChannelId, setManualChannelId] = useState('');

  useEffect(() => {
    if (user) {
      setTelegramConnected(!!user.telegram_session);
      setCloudinaryName(user.cloudinary_cloud_name || '');
      setCloudinaryKey(user.cloudinary_api_key || '');
      setCloudinarySecret(user.cloudinary_api_secret || '');
      setImgbbKey(user.imgbb_api_key || '');
      setWorkerUrl(user.worker_url || '');
      setBotUsername(user.telegram_bot_username || '');
      setManualChannelId(user.telegram_channel_id ? String(user.telegram_channel_id) : '');
    }
  }, [user]);

  const handleRequestQR = async () => {
    setLoading(true);
    try {
      const response = await axios.post(`${API}/telegram/request-qr`);
      setQrCode(response.data.qr_code);
      setQrSessionId(response.data.session_id);
      toast.success('QR code generated! Scan with Telegram app');

      // Poll for verification
      pollQRVerification(response.data.session_id);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to generate QR code');
    } finally {
      setLoading(false);
    }
  };

  const pollQRVerification = async (sessionId) => {
    const maxAttempts = 30;
    let attempts = 0;

    const poll = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(poll);
        toast.error('QR code expired');
        setQrCode(null);
        return;
      }

      try {
        const response = await axios.post(`${API}/telegram/verify-qr`, { session_id: sessionId });
        if (response.data.success) {
          clearInterval(poll);
          toast.success('Telegram connected successfully!');
          setTelegramConnected(true);
          setQrCode(null);
          window.location.reload();
        }
      } catch (error) {
        // Continue polling
      }
    }, 2000);
  };

  const handleRequestPhoneCode = async () => {
    if (!phoneNumber.trim()) {
      toast.error('Please enter phone number');
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post(`${API}/telegram/request-code`, { phone: phoneNumber });
      setPhoneSessionId(response.data.session_id);
      setPhoneCodeHash(response.data.phone_code_hash);
      setShowCodeInput(true);
      toast.success('Verification code sent to Telegram');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to send code');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!verificationCode.trim()) {
      toast.error('Please enter verification code');
      return;
    }

    setLoading(true);
    try {
      await axios.post(`${API}/telegram/verify-code`, {
        phone: phoneNumber,
        code: verificationCode,
        phone_code_hash: phoneCodeHash,
      });
      toast.success('Telegram connected successfully!');
      setTelegramConnected(true);
      setShowCodeInput(false);
      window.location.reload();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnectTelegram = async () => {
    try {
      await axios.post(`${API}/telegram/disconnect`);
      toast.success('Telegram disconnected');
      setTelegramConnected(false);
      window.location.reload();
    } catch (error) {
      toast.error('Failed to disconnect');
    }
  };

  const handleSaveBotToken = async () => {
    if (!botToken.trim()) {
      toast.error('Please enter bot token');
      return;
    }
    
    setLoading(true);
    try {
      const response = await axios.post(`${API}/settings/bot-token`, {
        bot_token: botToken,
      });
      toast.success(response.data.message || 'Bot token saved!');
      setBotToken('');
      window.location.reload();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to save bot token');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateChannelId = async () => {
    if (!manualChannelId.trim()) {
      toast.error('Please enter channel ID');
      return;
    }
    
    setLoading(true);
    try {
      const response = await axios.post(`${API}/telegram/update-channel`, {
        channel_id: parseInt(manualChannelId),
      });
      toast.success(response.data.message || 'Channel ID updated!');
      window.location.reload();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update channel ID');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveApiKeys = async () => {
    try {
      await axios.put(`${API}/settings/api-keys`, {
        cloudinary_cloud_name: cloudinaryName || null,
        cloudinary_api_key: cloudinaryKey || null,
        cloudinary_api_secret: cloudinarySecret || null,
        imgbb_api_key: imgbbKey || null,
        worker_url: workerUrl || null,
      });
      toast.success('API keys saved successfully!');
      // Reload to get updated user data
      window.location.reload();
    } catch (error) {
      toast.error('Failed to save API keys');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/dashboard')}
                data-testid="back-button"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="flex items-center space-x-3">
                <SettingsIcon className="w-6 h-6 text-indigo-600" />
                <h1 className="text-2xl font-bold text-indigo-600" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                  Settings
                </h1>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs defaultValue="telegram" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="telegram" data-testid="telegram-tab">
              <Send className="w-4 h-4 mr-2" />
              Telegram
            </TabsTrigger>
            <TabsTrigger value="storage" data-testid="storage-tab">
              <Cloud className="w-4 h-4 mr-2" />
              Storage Keys
            </TabsTrigger>
            <TabsTrigger value="worker" data-testid="worker-tab">
              <Key className="w-4 h-4 mr-2" />
              Worker Setup
            </TabsTrigger>
          </TabsList>

          {/* Telegram Connection */}
          <TabsContent value="telegram" className="space-y-6">
            <Card data-testid="telegram-connection-card">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Telegram Connection</span>
                  {telegramConnected ? (
                    <div className="flex items-center text-green-600">
                      <CheckCircle className="w-5 h-5 mr-2" />
                      <span className="text-sm">Connected</span>
                    </div>
                  ) : (
                    <div className="flex items-center text-gray-400">
                      <XCircle className="w-5 h-5 mr-2" />
                      <span className="text-sm">Not Connected</span>
                    </div>
                  )}
                </CardTitle>
                <CardDescription>
                  Connect your Telegram account to store files in your private channel
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {telegramConnected ? (
                  <div className="space-y-4">
                    <Alert>
                      <CheckCircle className="w-4 h-4" />
                      <AlertDescription>
                        Your Telegram is connected. Channel ID: {user?.telegram_channel_id}
                      </AlertDescription>
                    </Alert>
                    {user?.telegram_channel_invite && (
                      <div className="flex items-center space-x-2">
                        <Input value={user.telegram_channel_invite} readOnly />
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => {
                            navigator.clipboard.writeText(user.telegram_channel_invite);
                            toast.success('Copied!');
                          }}
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                    <Button
                      variant="destructive"
                      onClick={handleDisconnectTelegram}
                      data-testid="disconnect-telegram-button"
                    >
                      Disconnect Telegram
                    </Button>
                  </div>
                ) : (
                  <Tabs defaultValue="qr" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="qr">
                        <QrCode className="w-4 h-4 mr-2" />
                        QR Code
                      </TabsTrigger>
                      <TabsTrigger value="phone">
                        <Send className="w-4 h-4 mr-2" />
                        Phone
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="qr" className="space-y-4">
                      {qrCode ? (
                        <div className="flex flex-col items-center space-y-4">
                          <img src={qrCode} alt="QR Code" className="w-64 h-64" />
                          <p className="text-sm text-gray-600 text-center">
                            Scan this QR code with your Telegram app
                          </p>
                        </div>
                      ) : (
                        <Button
                          onClick={handleRequestQR}
                          disabled={loading}
                          className="w-full bg-indigo-600 hover:bg-indigo-700"
                          data-testid="generate-qr-button"
                        >
                          {loading ? 'Generating...' : 'Generate QR Code'}
                        </Button>
                      )}
                    </TabsContent>

                    <TabsContent value="phone" className="space-y-4">
                      {!showCodeInput ? (
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label>Phone Number (with country code)</Label>
                            <Input
                              data-testid="phone-input"
                              placeholder="+1234567890"
                              value={phoneNumber}
                              onChange={(e) => setPhoneNumber(e.target.value)}
                            />
                          </div>
                          <Button
                            onClick={handleRequestPhoneCode}
                            disabled={loading}
                            className="w-full bg-indigo-600 hover:bg-indigo-700"
                            data-testid="send-code-button"
                          >
                            {loading ? 'Sending...' : 'Send Verification Code'}
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label>Verification Code</Label>
                            <Input
                              data-testid="verification-code-input"
                              placeholder="12345"
                              value={verificationCode}
                              onChange={(e) => setVerificationCode(e.target.value)}
                            />
                          </div>
                          <Button
                            onClick={handleVerifyCode}
                            disabled={loading}
                            className="w-full bg-indigo-600 hover:bg-indigo-700"
                            data-testid="verify-code-button"
                          >
                            {loading ? 'Verifying...' : 'Verify Code'}
                          </Button>
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                )}
              </CardContent>
            </Card>

            {/* Bot Token Configuration */}
            {telegramConnected && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>Telegram Bot Token</span>
                    {botUsername && (
                      <div className="flex items-center text-green-600">
                        <CheckCircle className="w-5 h-5 mr-2" />
                        <span className="text-sm">@{botUsername}</span>
                      </div>
                    )}
                  </CardTitle>
                  <CardDescription>
                    Create a bot via @BotFather and add the token here for file uploads
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Alert>
                    <AlertDescription>
                      <strong>Steps to create a bot:</strong>
                      <ol className="list-decimal ml-5 mt-2 space-y-1 text-sm">
                        <li>Open Telegram and search for <strong>@BotFather</strong></li>
                        <li>Send command: <code className="bg-gray-100 px-2 py-1 rounded">/newbot</code></li>
                        <li>Follow instructions to choose a name and username</li>
                        <li>Copy the bot token and paste it below</li>
                      </ol>
                    </AlertDescription>
                  </Alert>
                  <div className="space-y-2">
                    <Label>Bot Token</Label>
                    <Input
                      type="password"
                      value={botToken}
                      onChange={(e) => setBotToken(e.target.value)}
                      placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                    />
                  </div>
                  <Button
                    onClick={handleSaveBotToken}
                    disabled={loading || !botToken.trim()}
                    className="w-full bg-indigo-600 hover:bg-indigo-700"
                  >
                    {loading ? 'Saving...' : 'Save Bot Token'}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Manual Channel ID */}
            {telegramConnected && (
              <Card>
                <CardHeader>
                  <CardTitle>Manual Channel ID (Optional)</CardTitle>
                  <CardDescription>
                    If automatic channel detection failed, you can manually enter your channel ID
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Alert>
                    <AlertDescription>
                      <strong>How to find your channel ID:</strong>
                      <ol className="list-decimal ml-5 mt-2 space-y-1 text-sm">
                        <li>Go to your "TeleStore Files" channel in Telegram</li>
                        <li>Forward any message from the channel to <strong>@userinfobot</strong></li>
                        <li>The bot will reply with the channel ID (format: -100XXXXXXXXXX)</li>
                        <li>Copy and paste it below</li>
                      </ol>
                    </AlertDescription>
                  </Alert>
                  <div className="space-y-2">
                    <Label>Channel ID</Label>
                    <Input
                      type="number"
                      value={manualChannelId}
                      onChange={(e) => setManualChannelId(e.target.value)}
                      placeholder="-1001234567890"
                    />
                    {user?.telegram_channel_id && (
                      <p className="text-sm text-gray-500">
                        Current: {user.telegram_channel_id}
                      </p>
                    )}
                  </div>
                  <Button
                    onClick={handleUpdateChannelId}
                    disabled={loading || !manualChannelId.trim()}
                    className="w-full"
                  >
                    {loading ? 'Updating...' : 'Update Channel ID'}
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Storage API Keys */}
          <TabsContent value="storage" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Cloud className="w-5 h-5 mr-2" />
                  Cloudinary Configuration
                </CardTitle>
                <CardDescription>
                  Get your keys from <a href="https://cloudinary.com/console" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">Cloudinary Console</a>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Cloud Name</Label>
                  <Input
                    data-testid="cloudinary-name-input"
                    value={cloudinaryName}
                    onChange={(e) => setCloudinaryName(e.target.value)}
                    placeholder="your-cloud-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>API Key</Label>
                  <Input
                    data-testid="cloudinary-key-input"
                    value={cloudinaryKey}
                    onChange={(e) => setCloudinaryKey(e.target.value)}
                    placeholder="123456789012345"
                  />
                </div>
                <div className="space-y-2">
                  <Label>API Secret</Label>
                  <Input
                    data-testid="cloudinary-secret-input"
                    type="password"
                    value={cloudinarySecret}
                    onChange={(e) => setCloudinarySecret(e.target.value)}
                    placeholder="••••••••••••"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <ImageIcon className="w-5 h-5 mr-2" />
                  ImgBB Configuration
                </CardTitle>
                <CardDescription>
                  Get your API key from <a href="https://api.imgbb.com/" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">ImgBB API</a>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>API Key</Label>
                  <Input
                    data-testid="imgbb-key-input"
                    value={imgbbKey}
                    onChange={(e) => setImgbbKey(e.target.value)}
                    placeholder="your-api-key"
                  />
                </div>
              </CardContent>
            </Card>

            <Button
              onClick={handleSaveApiKeys}
              className="w-full bg-indigo-600 hover:bg-indigo-700"
              data-testid="save-keys-button"
            >
              Save API Keys
            </Button>
          </TabsContent>

          {/* Worker Setup */}
          <TabsContent value="worker" className="space-y-6">
            {/* Worker URL Configuration */}
            <Card className="border-2 border-indigo-200">
              <CardHeader>
                <CardTitle className="flex items-center text-indigo-800">
                  <Key className="w-5 h-5 mr-2" />
                  Worker URL Configuration
                </CardTitle>
                <CardDescription>
                  Enter your deployed worker URL to enable file uploads
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Worker URL</Label>
                  <Input
                    data-testid="worker-url-input"
                    value={workerUrl}
                    onChange={(e) => setWorkerUrl(e.target.value)}
                    placeholder="https://your-worker.workers.dev or https://your-worker.vercel.app/api/upload"
                  />
                  {user?.worker_url && (
                    <p className="text-sm text-green-600 flex items-center">
                      <CheckCircle className="w-4 h-4 mr-1" />
                      Current: {user.worker_url}
                    </p>
                  )}
                </div>
                <Alert>
                  <AlertDescription className="text-sm">
                    <strong>Examples:</strong>
                    <ul className="list-disc ml-5 mt-2 space-y-1">
                      <li><strong>Cloudflare:</strong> https://your-worker.workers.dev</li>
                      <li><strong>Vercel:</strong> https://your-project.vercel.app/api/upload</li>
                      <li><strong>Render:</strong> https://your-service.onrender.com/upload</li>
                    </ul>
                  </AlertDescription>
                </Alert>
                <Button
                  onClick={handleSaveApiKeys}
                  className="w-full bg-indigo-600 hover:bg-indigo-700"
                  data-testid="save-worker-url-button"
                >
                  Save Worker URL
                </Button>
              </CardContent>
            </Card>

            {/* Automatic Credential Management Info */}
            <Card className="border-2 border-green-200 bg-green-50">
              <CardHeader>
                <CardTitle className="flex items-center text-green-800">
                  <CheckCircle className="w-5 h-5 mr-2" />
                  Automatic Credential Management
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-green-900">
                  <strong>Good news!</strong> Workers now automatically fetch credentials from the backend. You no longer need to manually configure bot tokens or channel IDs in worker environment variables!
                </p>
                <div className="bg-white p-3 rounded border border-green-200">
                  <p className="font-semibold mb-2 text-green-900">How it works:</p>
                  <ul className="list-disc ml-5 space-y-1 text-gray-700">
                    <li>Workers fetch credentials using your auth token</li>
                    <li>Credentials are cached for 1 hour (reduces API calls)</li>
                    <li>Automatic refresh when cache expires</li>
                    <li>Only <strong>BACKEND_URL</strong> needs to be configured</li>
                  </ul>
                </div>
              </CardContent>
            </Card>

            {/* Prerequisites Card */}
            <Card>
              <CardHeader>
                <CardTitle>Before You Deploy</CardTitle>
                <CardDescription>Complete these steps first</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-start space-x-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center ${telegramConnected ? 'bg-green-600' : 'bg-gray-300'}`}>
                    {telegramConnected ? (
                      <CheckCircle className="w-4 h-4 text-white" />
                    ) : (
                      <span className="text-white text-xs">1</span>
                    )}
                  </div>
                  <div>
                    <p className="font-semibold">Connect Telegram Account</p>
                    <p className="text-sm text-gray-600">Login via QR code or phone number</p>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center ${botUsername ? 'bg-green-600' : 'bg-gray-300'}`}>
                    {botUsername ? (
                      <CheckCircle className="w-4 h-4 text-white" />
                    ) : (
                      <span className="text-white text-xs">2</span>
                    )}
                  </div>
                  <div>
                    <p className="font-semibold">Add Bot Token</p>
                    <p className="text-sm text-gray-600">Create bot via @BotFather and add token in Telegram tab</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Deployment Options */}
            <Card>
              <CardHeader>
                <CardTitle>Choose Deployment Platform</CardTitle>
                <CardDescription>
                  Select a platform to deploy your upload worker
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Cloudflare Worker */}
                <div className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-lg">Cloudflare Workers</h3>
                      <p className="text-sm text-gray-600">Best for global CDN and fast uploads</p>
                    </div>
                    <a
                      href="https://workers.cloudflare.com"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="outline" size="sm">
                        <ExternalLink className="w-4 h-4 mr-2" />
                        Deploy
                      </Button>
                    </a>
                  </div>
                  <div className="bg-gray-50 p-3 rounded text-sm space-y-2">
                    <p className="font-semibold">Quick Setup:</p>
                    <code className="block bg-gray-800 text-green-400 p-2 rounded text-xs overflow-x-auto">
                      # Install Wrangler CLI<br/>
                      npm install -g wrangler<br/><br/>
                      # Create worker<br/>
                      wrangler init telestore-worker<br/><br/>
                      # Copy cloudflare-worker.js to src/index.js<br/>
                      # Update BACKEND_URL in code<br/><br/>
                      # Deploy<br/>
                      wrangler deploy
                    </code>
                  </div>
                </div>

                {/* Vercel Serverless */}
                <div className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-lg">Vercel Serverless</h3>
                      <p className="text-sm text-gray-600">Easy deployment with Git integration</p>
                    </div>
                    <a
                      href="https://vercel.com"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="outline" size="sm">
                        <ExternalLink className="w-4 h-4 mr-2" />
                        Deploy
                      </Button>
                    </a>
                  </div>
                  <div className="bg-gray-50 p-3 rounded text-sm space-y-2">
                    <p className="font-semibold">Quick Setup:</p>
                    <code className="block bg-gray-800 text-green-400 p-2 rounded text-xs overflow-x-auto">
                      # Create project<br/>
                      mkdir telestore-worker && cd telestore-worker<br/>
                      npm init -y<br/>
                      npm install form-data node-fetch<br/><br/>
                      # Create api/upload.js with vercel-serverless.js content<br/>
                      # Set BACKEND_URL in Vercel dashboard<br/><br/>
                      # Deploy<br/>
                      vercel deploy
                    </code>
                  </div>
                </div>

                {/* Render */}
                <div className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-lg">Render</h3>
                      <p className="text-sm text-gray-600">Python-based deployment</p>
                    </div>
                    <a
                      href="https://render.com"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="outline" size="sm">
                        <ExternalLink className="w-4 h-4 mr-2" />
                        Deploy
                      </Button>
                    </a>
                  </div>
                  <div className="bg-gray-50 p-3 rounded text-sm space-y-2">
                    <p className="font-semibold">Quick Setup:</p>
                    <code className="block bg-gray-800 text-green-400 p-2 rounded text-xs overflow-x-auto">
                      # Upload render-service.py to Render<br/>
                      # Create requirements.txt:<br/>
                      Flask==3.0.0<br/>
                      requests==2.31.0<br/>
                      gunicorn==21.2.0<br/><br/>
                      # Set BACKEND_URL in Render dashboard<br/>
                      # Deploy
                    </code>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Important Notes */}
            <Alert>
              <AlertDescription className="space-y-2">
                <p className="font-semibold">✅ Configuration Required:</p>
                <ul className="list-disc ml-5 space-y-1 text-sm">
                  <li>Set only <code className="bg-gray-100 px-2 py-1 rounded">BACKEND_URL</code> environment variable</li>
                  <li>No need to set bot tokens or channel IDs manually</li>
                  <li>Worker will fetch credentials automatically from backend</li>
                </ul>
                <p className="font-semibold mt-3">📚 Detailed Documentation:</p>
                <p className="text-sm">
                  See <code className="bg-gray-100 px-2 py-1 rounded">/worker-templates/README.md</code> for complete instructions
                </p>
              </AlertDescription>
            </Alert>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
