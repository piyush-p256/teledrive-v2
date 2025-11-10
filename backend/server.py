from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, UploadFile, File, Form
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta
from passlib.context import CryptContext
from jose import JWTError, jwt
import asyncio
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.functions.channels import CreateChannelRequest
from telethon.tl.functions.messages import ExportChatInviteRequest
import base64
import io
import qrcode
import requests
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Security
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()
SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "your-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 43200  # 30 days

# Telegram clients storage (in-memory for demo, use Redis in production)
telegram_clients = {}

# Create the main app
app = FastAPI()
api_router = APIRouter(prefix="/api")

# Logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ========== MODELS ==========

class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    email: EmailStr
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    telegram_session: Optional[str] = None
    telegram_user_id: Optional[int] = None
    telegram_channel_id: Optional[int] = None
    telegram_channel_invite: Optional[str] = None
    telegram_bot_token: Optional[str] = None
    telegram_bot_username: Optional[str] = None
    cloudinary_cloud_name: Optional[str] = None
    cloudinary_api_key: Optional[str] = None
    cloudinary_api_secret: Optional[str] = None
    imgbb_api_key: Optional[str] = None
    worker_url: Optional[str] = None

class UserSignup(BaseModel):
    email: EmailStr
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str

class FileMetadata(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: str
    size: int
    mime_type: str
    telegram_msg_id: int
    telegram_file_id: Optional[str] = None
    thumbnail_url: Optional[str] = None
    thumbnail_provider: Optional[str] = None  # 'cloudinary' or 'imgbb'
    folder_id: Optional[str] = None
    is_trashed: bool = False
    trashed_at: Optional[datetime] = None
    is_public: bool = False
    share_token: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class FileCreate(BaseModel):
    name: str
    size: int
    mime_type: str
    telegram_msg_id: int
    telegram_file_id: Optional[str] = None
    thumbnail_url: Optional[str] = None
    thumbnail_provider: Optional[str] = None
    folder_id: Optional[str] = None

class FileUpdate(BaseModel):
    name: Optional[str] = None
    folder_id: Optional[str] = None

class Folder(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: str
    parent_id: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class FolderCreate(BaseModel):
    name: str
    parent_id: Optional[str] = None

class ApiKeysUpdate(BaseModel):
    cloudinary_cloud_name: Optional[str] = None
    cloudinary_api_key: Optional[str] = None
    cloudinary_api_secret: Optional[str] = None
    imgbb_api_key: Optional[str] = None
    worker_url: Optional[str] = None

class BotTokenUpdate(BaseModel):
    bot_token: str

class BotTokenUpdate(BaseModel):
    bot_token: str

class TelegramLoginRequest(BaseModel):
    phone: Optional[str] = None

class TelegramCodeVerify(BaseModel):
    phone: str
    code: str
    phone_code_hash: str

class TelegramQRRequest(BaseModel):
    session_id: str

class ChannelIdUpdate(BaseModel):
    channel_id: int

class FaceDetection(BaseModel):
    box: dict  # {x, y, width, height}
    descriptor: List[float]  # 128-dimensional face descriptor
    confidence: float

class FaceDataCreate(BaseModel):
    file_id: str
    detections: List[FaceDetection]

class FaceData(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    file_id: str
    user_id: str
    person_id: Optional[str] = None  # Assigned after grouping
    descriptor: List[float]
    box: dict  # Bounding box coordinates
    confidence: float
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class Person(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: Optional[str] = None
    photo_count: int = 0
    sample_photo_url: Optional[str] = None
    sample_file_id: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class PersonUpdate(BaseModel):
    name: str

class PersonMerge(BaseModel):
    person_ids: List[str]  # List of person IDs to merge
    target_person_id: str  # The person to merge into

class BulkDeleteRequest(BaseModel):
    file_ids: List[str]

class BulkShareRequest(BaseModel):
    file_ids: List[str]

class SharedCollection(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    file_ids: List[str]
    share_token: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ========== AUTH HELPERS ==========

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    # Truncate password to 72 bytes as required by bcrypt
    return pwd_context.hash(password.encode('utf-8')[:72])

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        token = credentials.credentials
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "hashed_password": 0})
        if user is None:
            raise HTTPException(status_code=401, detail="User not found")
        return User(**user)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ========== AUTH ROUTES ==========

@api_router.post("/auth/signup", response_model=TokenResponse)
async def signup(user_data: UserSignup):
    # Check if user exists
    existing = await db.users.find_one({"email": user_data.email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Create user
    user = User(email=user_data.email)
    user_dict = user.model_dump()
    user_dict['hashed_password'] = get_password_hash(user_data.password)
    user_dict['created_at'] = user_dict['created_at'].isoformat()
    
    await db.users.insert_one(user_dict)
    
    # Create token
    access_token = create_access_token({"sub": user.id})
    return TokenResponse(access_token=access_token, token_type="bearer")

@api_router.post("/auth/login", response_model=TokenResponse)
async def login(user_data: UserLogin):
    user = await db.users.find_one({"email": user_data.email})
    if not user or not verify_password(user_data.password, user.get('hashed_password', '')):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    access_token = create_access_token({"sub": user['id']})
    return TokenResponse(access_token=access_token, token_type="bearer")

@api_router.get("/auth/me", response_model=User)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


# ========== TELEGRAM ROUTES ==========

@api_router.post("/telegram/request-qr")
async def request_qr_code(current_user: User = Depends(get_current_user)):
    """Generate QR code for Telegram login"""
    try:
        # Create a temporary session
        session_id = str(uuid.uuid4())
        client = TelegramClient(
            StringSession(),
            int(os.environ.get('TELEGRAM_API_ID', '0')),
            os.environ.get('TELEGRAM_API_HASH', '')
        )
        
        await client.connect()
        qr_login = await client.qr_login()
        
        # Generate QR code image
        qr = qrcode.QRCode(version=1, box_size=10, border=5)
        qr.add_data(qr_login.url)
        qr.make(fit=True)
        
        img = qr.make_image(fill_color="black", back_color="white")
        buffer = io.BytesIO()
        img.save(buffer, format='PNG')
        qr_image = base64.b64encode(buffer.getvalue()).decode()
        
        # Store client temporarily
        telegram_clients[session_id] = {
            'client': client,
            'qr_login': qr_login,
            'user_id': current_user.id
        }
        
        return {
            "session_id": session_id,
            "qr_code": f"data:image/png;base64,{qr_image}",
            "url": qr_login.url
        }
    except Exception as e:
        logger.error(f"QR generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate QR code: {str(e)}")

@api_router.post("/telegram/verify-qr")
async def verify_qr_login(request: TelegramQRRequest, current_user: User = Depends(get_current_user)):
    """Check if QR code was scanned and complete login"""
    session_data = telegram_clients.get(request.session_id)
    if not session_data:
        raise HTTPException(status_code=404, detail="Session not found")
    
    try:
        client = session_data['client']
        qr_login = session_data['qr_login']
        
        # Wait for QR login
        await qr_login.wait(timeout=5)
        me = await client.get_me()
        
        # Save session
        session_string = StringSession.save(client.session)
        
        # Create private channel
        result = await client(CreateChannelRequest(
            title='TeleStore Files',
            about='Private storage for TeleStore',
            megagroup=False
        ))
        
        # Get the channel ID (Telegram uses -100 prefix for channel IDs)
        channel = result.chats[0]
        channel_id = -1000000000000 - channel.id  # Convert to proper channel ID format
        
        # Try to export invite link
        invite_link = None
        try:
            invite_result = await client(ExportChatInviteRequest(
                peer=channel,
                legacy_revoke_permanent=False
            ))
            invite_link = invite_result.link
        except Exception as e:
            logger.warning(f"Failed to export invite link: {str(e)}")
            # Continue without invite link
        
        # Update user
        await db.users.update_one(
            {"id": current_user.id},
            {"$set": {
                "telegram_session": session_string,
                "telegram_user_id": me.id,
                "telegram_channel_id": channel_id,
                "telegram_channel_invite": invite_link
            }}
        )
        
        # Cleanup
        await client.disconnect()
        del telegram_clients[request.session_id]
        
        return {
            "success": True,
            "telegram_user_id": me.id,
            "channel_id": channel_id,
            "channel_invite": invite_link
        }
    except asyncio.TimeoutError:
        return {"success": False, "message": "QR code not scanned yet"}
    except Exception as e:
        logger.error(f"QR verification error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/telegram/request-code")
async def request_phone_code(request: TelegramLoginRequest, current_user: User = Depends(get_current_user)):
    """Request verification code for phone login"""
    try:
        session_id = str(uuid.uuid4())
        client = TelegramClient(
            StringSession(),
            int(os.environ.get('TELEGRAM_API_ID', '0')),
            os.environ.get('TELEGRAM_API_HASH', '')
        )
        
        await client.connect()
        result = await client.send_code_request(request.phone)
        
        telegram_clients[session_id] = {
            'client': client,
            'phone': request.phone,
            'phone_code_hash': result.phone_code_hash,
            'user_id': current_user.id
        }
        
        return {
            "session_id": session_id,
            "phone_code_hash": result.phone_code_hash,
            "message": "Code sent to your Telegram"
        }
    except Exception as e:
        logger.error(f"Phone code request error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/telegram/verify-code")
async def verify_phone_code(request: TelegramCodeVerify, current_user: User = Depends(get_current_user)):
    """Verify phone code and complete login"""
    # Find session by phone and phone_code_hash
    session_data = None
    session_id = None
    for sid, data in telegram_clients.items():
        if data.get('phone') == request.phone and data.get('phone_code_hash') == request.phone_code_hash:
            session_data = data
            session_id = sid
            break
    
    if not session_data:
        raise HTTPException(status_code=404, detail="Session not found")
    
    try:
        client = session_data['client']
        
        # Sign in with code
        await client.sign_in(request.phone, request.code, phone_code_hash=request.phone_code_hash)
        me = await client.get_me()
        
        # Save session
        session_string = StringSession.save(client.session)
        
        # Create private channel
        result = await client(CreateChannelRequest(
            title='TeleStore Files',
            about='Private storage for TeleStore',
            megagroup=False
        ))
        
        # Get the channel ID (Telegram uses -100 prefix for channel IDs)
        channel = result.chats[0]
        channel_id = -1000000000000 - channel.id  # Convert to proper channel ID format
        
        # Try to export invite link
        invite_link = None
        try:
            invite_result = await client(ExportChatInviteRequest(
                peer=channel,
                legacy_revoke_permanent=False
            ))
            invite_link = invite_result.link
        except Exception as e:
            logger.warning(f"Failed to export invite link: {str(e)}")
            # Continue without invite link
        
        # Update user
        await db.users.update_one(
            {"id": current_user.id},
            {"$set": {
                "telegram_session": session_string,
                "telegram_user_id": me.id,
                "telegram_channel_id": channel_id,
                "telegram_channel_invite": invite_link
            }}
        )
        
        # Cleanup
        await client.disconnect()
        del telegram_clients[session_id]
        
        return {
            "success": True,
            "telegram_user_id": me.id,
            "channel_id": channel_id,
            "channel_invite": invite_link
        }
    except Exception as e:
        logger.error(f"Code verification error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/telegram/disconnect")
async def disconnect_telegram(current_user: User = Depends(get_current_user)):
    """Disconnect Telegram account"""
    await db.users.update_one(
        {"id": current_user.id},
        {"$set": {
            "telegram_session": None,
            "telegram_user_id": None,
            "telegram_channel_id": None,
            "telegram_channel_invite": None
        }}
    )
    return {"success": True}

@api_router.post("/telegram/update-channel")
async def update_channel_id(request: ChannelIdUpdate, current_user: User = Depends(get_current_user)):
    """Manually update channel ID"""
    if not current_user.telegram_session:
        raise HTTPException(status_code=400, detail="Please connect Telegram first")
    
    await db.users.update_one(
        {"id": current_user.id},
        {"$set": {"telegram_channel_id": request.channel_id}}
    )
    
    return {
        "success": True,
        "channel_id": request.channel_id,
        "message": "Channel ID updated successfully"
    }


# ========== API KEYS ROUTES ==========

@api_router.put("/settings/api-keys")
async def update_api_keys(keys: ApiKeysUpdate, current_user: User = Depends(get_current_user)):
    """Update Cloudinary and imgbb API keys"""
    update_data = {k: v for k, v in keys.model_dump().items() if v is not None}
    
    if update_data:
        await db.users.update_one(
            {"id": current_user.id},
            {"$set": update_data}
        )
    
    return {"success": True}

@api_router.post("/settings/bot-token")
async def update_bot_token(data: BotTokenUpdate, current_user: User = Depends(get_current_user)):
    """Save Telegram bot token and add bot to channel"""
    try:
        # Verify bot token is valid
        import requests
        bot_response = requests.get(f"https://api.telegram.org/bot{data.bot_token}/getMe")
        bot_data = bot_response.json()
        
        if not bot_data.get('ok'):
            raise HTTPException(status_code=400, detail="Invalid bot token")
        
        bot_username = bot_data['result']['username']
        
        # If user has telegram session, add bot as admin to channel
        if current_user.telegram_session and current_user.telegram_channel_id:
            try:
                client = TelegramClient(
                    StringSession(current_user.telegram_session),
                    int(os.environ.get('TELEGRAM_API_ID', '0')),
                    os.environ.get('TELEGRAM_API_HASH', '')
                )
                await client.connect()
                
                # Add bot to channel as admin
                from telethon.tl.functions.channels import InviteToChannelRequest, EditAdminRequest
                from telethon.tl.types import ChatAdminRights
                
                # Get bot user
                bot_user = await client.get_entity(bot_username)
                
                # Invite bot to channel
                try:
                    await client(InviteToChannelRequest(
                        current_user.telegram_channel_id,
                        [bot_user]
                    ))
                except:
                    pass  # Bot might already be in channel
                
                # Make bot admin
                rights = ChatAdminRights(
                    post_messages=True,
                    edit_messages=True,
                    delete_messages=True,
                )
                await client(EditAdminRequest(
                    current_user.telegram_channel_id,
                    bot_user,
                    rights,
                    "TeleStore Bot"
                ))
                
                await client.disconnect()
            except Exception as e:
                logger.error(f"Failed to add bot to channel: {str(e)}")
                # Continue anyway, user can add manually
        
        # Save bot token
        await db.users.update_one(
            {"id": current_user.id},
            {"$set": {
                "telegram_bot_token": data.bot_token,
                "telegram_bot_username": bot_username
            }}
        )
        
        return {
            "success": True,
            "bot_username": bot_username,
            "message": "Bot token saved successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Bot token update error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/worker/credentials")
async def get_worker_credentials(current_user: User = Depends(get_current_user)):
    """Get worker credentials - called by worker to fetch bot token and channel ID"""
    if not current_user.telegram_bot_token or not current_user.telegram_channel_id:
        raise HTTPException(
            status_code=400,
            detail="Telegram not fully configured. Please connect Telegram and add bot token in settings."
        )
    
    return {
        "bot_token": current_user.telegram_bot_token,
        "channel_id": str(current_user.telegram_channel_id),
        "telegram_session": current_user.telegram_session,
        "telegram_api_id": os.environ.get('TELEGRAM_API_ID'),
        "telegram_api_hash": os.environ.get('TELEGRAM_API_HASH'),
        "user_id": current_user.id,
        "backend_url": os.environ.get('BACKEND_URL', 'https://your-backend.com')
    }

@api_router.post("/worker/verify-download-token")
async def verify_download_token(token: str = Form(...)):
    """Verify download token and return credentials for streaming - called by worker"""
    try:
        # Decode and verify token
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("user_id")
        
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        
        # Get user credentials
        user = await db.users.find_one({"id": user_id}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        if not user.get('telegram_session') or not user.get('telegram_channel_id'):
            raise HTTPException(
                status_code=400,
                detail="Telegram not configured"
            )
        
        return {
            "valid": True,
            "telegram_session": user['telegram_session'],
            "telegram_api_id": os.environ.get('TELEGRAM_API_ID'),
            "telegram_api_hash": os.environ.get('TELEGRAM_API_HASH'),
            "channel_id": str(user['telegram_channel_id']),
            "user_id": user_id
        }
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    except Exception as e:
        logger.error(f"Token verification error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ========== FILE ROUTES ==========

@api_router.post("/files", response_model=FileMetadata)
async def create_file(file: FileCreate, current_user: User = Depends(get_current_user)):
    """Create file metadata after upload"""
    file_obj = FileMetadata(user_id=current_user.id, **file.model_dump())
    file_dict = file_obj.model_dump()
    file_dict['created_at'] = file_dict['created_at'].isoformat()
    
    await db.files.insert_one(file_dict)
    return file_obj

@api_router.get("/files", response_model=List[FileMetadata])
async def list_files(folder_id: Optional[str] = None, current_user: User = Depends(get_current_user)):
    """List files in folder or root"""
    query = {"user_id": current_user.id, "is_trashed": False}
    if folder_id:
        query["folder_id"] = folder_id
    else:
        query["folder_id"] = None
    
    files = await db.files.find(query, {"_id": 0}).to_list(1000)
    for f in files:
        if isinstance(f['created_at'], str):
            f['created_at'] = datetime.fromisoformat(f['created_at'])
    return files

@api_router.get("/files/{file_id}", response_model=FileMetadata)
async def get_file(file_id: str, current_user: User = Depends(get_current_user)):
    """Get file details"""
    file = await db.files.find_one({"id": file_id, "user_id": current_user.id}, {"_id": 0})
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    if isinstance(file['created_at'], str):
        file['created_at'] = datetime.fromisoformat(file['created_at'])
    return FileMetadata(**file)

@api_router.put("/files/{file_id}")
async def update_file(file_id: str, update: FileUpdate, current_user: User = Depends(get_current_user)):
    """Update file (rename, move)"""
    update_data = {k: v for k, v in update.model_dump().items() if v is not None}
    
    if update_data:
        result = await db.files.update_one(
            {"id": file_id, "user_id": current_user.id},
            {"$set": update_data}
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="File not found")
    
    return {"success": True}

@api_router.delete("/files/{file_id}")
async def delete_file(file_id: str, permanent: bool = False, current_user: User = Depends(get_current_user)):
    """Delete file (move to trash or permanent)"""
    if permanent:
        # Get file info before deleting
        file = await db.files.find_one({"id": file_id, "user_id": current_user.id})
        if not file:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Permanently delete file
        await permanently_delete_file(file, current_user)
        result = await db.files.delete_one({"id": file_id, "user_id": current_user.id})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="File not found")
    else:
        result = await db.files.update_one(
            {"id": file_id, "user_id": current_user.id},
            {"$set": {"is_trashed": True, "trashed_at": datetime.now(timezone.utc).isoformat()}}
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="File not found")
    
    return {"success": True}

@api_router.post("/files/{file_id}/restore")
async def restore_file(file_id: str, current_user: User = Depends(get_current_user)):
    """Restore file from trash"""
    result = await db.files.update_one(
        {"id": file_id, "user_id": current_user.id},
        {"$set": {"is_trashed": False, "trashed_at": None}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="File not found")
    return {"success": True}

@api_router.get("/files/trash/list", response_model=List[FileMetadata])
async def list_trash(current_user: User = Depends(get_current_user)):
    """List trashed files"""
    files = await db.files.find({"user_id": current_user.id, "is_trashed": True}, {"_id": 0}).to_list(1000)
    for f in files:
        if isinstance(f['created_at'], str):
            f['created_at'] = datetime.fromisoformat(f['created_at'])
    return files

@api_router.post("/files/{file_id}/share")
async def share_file(file_id: str, current_user: User = Depends(get_current_user)):
    """Generate public share link"""
    share_token = str(uuid.uuid4())
    result = await db.files.update_one(
        {"id": file_id, "user_id": current_user.id},
        {"$set": {"is_public": True, "share_token": share_token}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="File not found")
    return {"share_token": share_token, "share_url": f"/share/{share_token}"}

@api_router.delete("/files/{file_id}/share")
async def unshare_file(file_id: str, current_user: User = Depends(get_current_user)):
    """Revoke public share link"""
    result = await db.files.update_one(
        {"id": file_id, "user_id": current_user.id},
        {"$set": {"is_public": False, "share_token": None}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="File not found")
    return {"success": True}

@api_router.get("/share/{share_token}", response_model=FileMetadata)
async def get_shared_file(share_token: str):
    """Get shared file by token"""
    file = await db.files.find_one({"share_token": share_token, "is_public": True}, {"_id": 0})
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    if isinstance(file['created_at'], str):
        file['created_at'] = datetime.fromisoformat(file['created_at'])
    return FileMetadata(**file)

@api_router.get("/files/{file_id}/download-url")
async def get_file_download_url(file_id: str, current_user: User = Depends(get_current_user)):
    """Get Telegram download URL for file - uses Bot API for small files, worker streaming for large files"""
    file = await db.files.find_one({"id": file_id, "user_id": current_user.id}, {"_id": 0})
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    if not current_user.telegram_bot_token:
        raise HTTPException(status_code=400, detail="Bot token not configured")
    
    file_size = file.get('size', 0)
    BOT_API_LIMIT = 20 * 1024 * 1024  # 20 MB - Telegram Bot API limit
    
    # For large files (>20MB), use worker streaming
    if file_size > BOT_API_LIMIT:
        if not current_user.worker_url:
            raise HTTPException(
                status_code=400, 
                detail="Worker URL not configured. Large files require a worker for streaming."
            )
        
        # Generate a temporary token for this download (valid for 1 hour)
        from jose import jwt
        download_token = jwt.encode(
            {
                "user_id": current_user.id,
                "file_id": file_id,
                "exp": datetime.now(timezone.utc) + timedelta(hours=1)
            },
            SECRET_KEY,
            algorithm=ALGORITHM
        )
        
        # Return worker streaming URL
        worker_base = current_user.worker_url.rstrip('/')
        download_url = f"{worker_base}/download?messageId={file['telegram_msg_id']}&token={download_token}&fileName={file['name']}"
        
        return {
            "download_url": download_url,
            "type": "stream",
            "size": file_size
        }
    
    # For small files (<20MB), use direct Bot API
    try:
        import requests
        # Get file info from Telegram
        response = requests.get(
            f"https://api.telegram.org/bot{current_user.telegram_bot_token}/getFile",
            params={"file_id": file.get('telegram_file_id', '')} if file.get('telegram_file_id') else {}
        )
        
        # If no file_id stored, try to get message
        if not file.get('telegram_file_id'):
            raise HTTPException(
                status_code=400, 
                detail="File ID not found. Please re-upload the file."
            )
        
        data = response.json()
        if not data.get('ok'):
            raise HTTPException(status_code=500, detail="Failed to get file from Telegram")
        
        file_path = data['result']['file_path']
        download_url = f"https://api.telegram.org/file/bot{current_user.telegram_bot_token}/{file_path}"
        
        return {
            "download_url": download_url,
            "type": "direct",
            "size": file_size
        }
    except Exception as e:
        logger.error(f"Download URL error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/share/{share_token}/download-url")
async def get_shared_file_download_url(share_token: str):
    """Get Telegram download URL for shared file - uses Bot API for small files, worker streaming for large files"""
    file = await db.files.find_one({"share_token": share_token, "is_public": True}, {"_id": 0})
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Get user's bot token
    user = await db.users.find_one({"id": file['user_id']}, {"_id": 0})
    if not user or not user.get('telegram_bot_token'):
        raise HTTPException(status_code=400, detail="Bot token not configured")
    
    file_size = file.get('size', 0)
    BOT_API_LIMIT = 20 * 1024 * 1024  # 20 MB
    
    # For large files (>20MB), use worker streaming
    if file_size > BOT_API_LIMIT:
        if not user.get('worker_url'):
            raise HTTPException(
                status_code=400, 
                detail="Worker URL not configured. Large files require a worker for streaming."
            )
        
        # Generate a temporary token for this download
        from jose import jwt
        download_token = jwt.encode(
            {
                "user_id": user['id'],
                "file_id": file['id'],
                "exp": datetime.now(timezone.utc) + timedelta(hours=1)
            },
            SECRET_KEY,
            algorithm=ALGORITHM
        )
        
        # Return worker streaming URL
        worker_base = user['worker_url'].rstrip('/')
        download_url = f"{worker_base}/download?messageId={file['telegram_msg_id']}&token={download_token}&fileName={file['name']}"
        
        return {
            "download_url": download_url,
            "type": "stream",
            "size": file_size
        }
    
    # For small files (<20MB), use direct Bot API
    try:
        import requests
        # Get file info from Telegram using telegram_file_id if available
        if file.get('telegram_file_id'):
            response = requests.get(
                f"https://api.telegram.org/bot{user['telegram_bot_token']}/getFile",
                params={"file_id": file['telegram_file_id']}
            )
            
            data = response.json()
            if data.get('ok'):
                file_path = data['result']['file_path']
                download_url = f"https://api.telegram.org/file/bot{user['telegram_bot_token']}/{file_path}"
                return {
                    "download_url": download_url,
                    "type": "direct",
                    "size": file_size
                }
        
        # Fallback: Try to forward the message and get file_id
        # This is a workaround if file_id wasn't stored during upload
        raise HTTPException(
            status_code=400, 
            detail="Unable to generate download link. File may need to be re-uploaded."
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Shared download URL error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ========== SHARED COLLECTION ROUTES ==========

@api_router.get("/share/collection/{share_token}")
async def get_shared_collection(share_token: str):
    """Get shared collection with all files"""
    collection = await db.shared_collections.find_one(
        {"share_token": share_token}, 
        {"_id": 0}
    )
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    
    # Get all files in the collection
    files = await db.files.find(
        {"id": {"$in": collection['file_ids']}, "is_public": True},
        {"_id": 0}
    ).to_list(None)
    
    # Parse dates for serialization
    for file in files:
        if isinstance(file.get('created_at'), str):
            file['created_at'] = datetime.fromisoformat(file['created_at'])
    
    return {
        "collection": collection,
        "files": files,
        "file_count": len(files)
    }

@api_router.get("/share/collection/{share_token}/file/{file_id}/download-url")
async def get_collection_file_download_url(share_token: str, file_id: str):
    """Get download URL for a specific file in a shared collection - supports large file streaming"""
    # Verify collection exists and contains this file
    collection = await db.shared_collections.find_one(
        {"share_token": share_token},
        {"_id": 0}
    )
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    
    if file_id not in collection['file_ids']:
        raise HTTPException(status_code=404, detail="File not in this collection")
    
    # Get the file
    file = await db.files.find_one(
        {"id": file_id, "is_public": True},
        {"_id": 0}
    )
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Get user's bot token
    user = await db.users.find_one({"id": file['user_id']}, {"_id": 0})
    if not user or not user.get('telegram_bot_token'):
        raise HTTPException(status_code=400, detail="Bot token not configured")
    
    file_size = file.get('size', 0)
    BOT_API_LIMIT = 20 * 1024 * 1024  # 20 MB
    
    # For large files (>20MB), use worker streaming
    if file_size > BOT_API_LIMIT:
        if not user.get('worker_url'):
            raise HTTPException(
                status_code=400, 
                detail="Worker URL not configured. Large files require a worker for streaming."
            )
        
        # Generate a temporary token for this download
        from jose import jwt
        download_token = jwt.encode(
            {
                "user_id": user['id'],
                "file_id": file_id,
                "exp": datetime.now(timezone.utc) + timedelta(hours=1)
            },
            SECRET_KEY,
            algorithm=ALGORITHM
        )
        
        # Return worker streaming URL
        worker_base = user['worker_url'].rstrip('/')
        download_url = f"{worker_base}/download?messageId={file['telegram_msg_id']}&token={download_token}&fileName={file['name']}"
        
        return {
            "download_url": download_url,
            "file_name": file.get('name', 'file'),
            "type": "stream",
            "size": file_size
        }
    
    # For small files (<20MB), use direct Bot API
    try:
        import requests
        if file.get('telegram_file_id'):
            response = requests.get(
                f"https://api.telegram.org/bot{user['telegram_bot_token']}/getFile",
                params={"file_id": file['telegram_file_id']}
            )
            
            data = response.json()
            if data.get('ok'):
                file_path = data['result']['file_path']
                download_url = f"https://api.telegram.org/file/bot{user['telegram_bot_token']}/{file_path}"
                return {
                    "download_url": download_url,
                    "file_name": file.get('name', 'file'),
                    "type": "direct",
                    "size": file_size
                }
        
        raise HTTPException(
            status_code=400, 
            detail="Unable to generate download link."
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Collection file download error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ========== FOLDER ROUTES ==========

@api_router.post("/folders", response_model=Folder)
async def create_folder(folder: FolderCreate, current_user: User = Depends(get_current_user)):
    """Create new folder"""
    folder_obj = Folder(user_id=current_user.id, **folder.model_dump())
    folder_dict = folder_obj.model_dump()
    folder_dict['created_at'] = folder_dict['created_at'].isoformat()
    
    await db.folders.insert_one(folder_dict)
    return folder_obj

@api_router.get("/folders", response_model=List[Folder])
async def list_folders(parent_id: Optional[str] = None, current_user: User = Depends(get_current_user)):
    """List folders"""
    query = {"user_id": current_user.id}
    if parent_id:
        query["parent_id"] = parent_id
    else:
        query["parent_id"] = None
    
    folders = await db.folders.find(query, {"_id": 0}).to_list(1000)
    for f in folders:
        if isinstance(f['created_at'], str):
            f['created_at'] = datetime.fromisoformat(f['created_at'])
    return folders

@api_router.put("/folders/{folder_id}")
async def update_folder(folder_id: str, update: FolderCreate, current_user: User = Depends(get_current_user)):
    """Update folder (rename)"""
    result = await db.folders.update_one(
        {"id": folder_id, "user_id": current_user.id},
        {"$set": {"name": update.name}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Folder not found")
    return {"success": True}

@api_router.delete("/folders/{folder_id}")
async def delete_folder(folder_id: str, current_user: User = Depends(get_current_user)):
    """Delete folder and its contents"""
    # Delete folder
    result = await db.folders.delete_one({"id": folder_id, "user_id": current_user.id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Folder not found")
    
    # Move files to trash
    await db.files.update_many(
        {"user_id": current_user.id, "folder_id": folder_id},
        {"$set": {"is_trashed": True, "folder_id": None}}
    )
    
    return {"success": True}


# ========== WORKER WEBHOOK ==========

@api_router.post("/webhook/upload")
async def worker_upload_webhook(data: dict):
    """Receive upload confirmation from worker"""
    # This endpoint will be called by the worker after successful upload
    logger.info(f"Upload webhook received: {data}")
    return {"success": True}


# ========== FACE RECOGNITION ROUTES ==========

@api_router.post("/faces")
async def store_face_data(face_data: FaceDataCreate, current_user: User = Depends(get_current_user)):
    """Store face detection data for a file and auto-group into people"""
    try:
        # Verify the file belongs to the user
        file = await db.files.find_one({"id": face_data.file_id, "user_id": current_user.id})
        if not file:
            raise HTTPException(status_code=404, detail="File not found")
        
        logger.info(f"Processing {len(face_data.detections)} face(s) for file {face_data.file_id}")
        
        # Store each detected face and track which people got new photos
        stored_faces = []
        people_with_new_photos = set()
        
        for detection in face_data.detections:
            # Find matching person by comparing descriptors
            person_id, is_new_person = await find_or_create_person(
                current_user.id,
                detection.descriptor,
                file.get('thumbnail_url'),
                face_data.file_id
            )
            
            # Track people who got a face in this file
            people_with_new_photos.add(person_id)
            
            face = FaceData(
                file_id=face_data.file_id,
                user_id=current_user.id,
                person_id=person_id,
                descriptor=detection.descriptor,
                box=detection.box,
                confidence=detection.confidence
            )
            
            face_dict = face.model_dump()
            face_dict['created_at'] = face_dict['created_at'].isoformat()
            await db.faces.insert_one(face_dict)
            stored_faces.append(face.id)
        
        # Update photo counts only once per person per file
        # Count unique files for each person
        for person_id in people_with_new_photos:
            unique_files = await db.faces.aggregate([
                {"$match": {"person_id": person_id, "user_id": current_user.id}},
                {"$group": {"_id": "$file_id"}},
                {"$count": "total"}
            ]).to_list(1)
            
            photo_count = unique_files[0]['total'] if unique_files else 0
            await db.people.update_one(
                {"id": person_id},
                {"$set": {
                    "photo_count": photo_count,
                    "updated_at": datetime.now(timezone.utc).isoformat()
                }}
            )
        
        return {"success": True, "face_ids": stored_faces}
    except Exception as e:
        logger.error(f"Face storage error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


async def find_or_create_person(user_id: str, descriptor: List[float], sample_photo_url: Optional[str], file_id: str) -> tuple[str, bool]:
    """Find existing person by face similarity or create new person
    Handles variations like glasses, lighting, angles
    Returns: (person_id, is_new_person)
    """
    import numpy as np
    
    # Get all existing people for this user
    people = await db.people.find({"user_id": user_id}).to_list(1000)
    
    # Multi-tier matching thresholds for better accuracy with accessories
    # Primary threshold: strict matching for clear cases
    primary_threshold = 0.5
    # Secondary threshold: more lenient for accessories like glasses
    secondary_threshold = 0.58
    
    new_descriptor = np.array(descriptor)
    
    logger.info(f"Comparing face against {len(people)} existing people")
    
    best_match = None
    best_distance = float('inf')
    best_match_quality = None
    
    for person in people:
        # Get ALL faces from this person to compare against
        existing_faces = await db.faces.find({"person_id": person['id'], "user_id": user_id}).to_list(None)
        
        if existing_faces:
            # Compare new face against ALL existing faces of this person
            distances = []
            
            for existing_face in existing_faces:
                # Calculate Euclidean distance between descriptors
                existing_descriptor = np.array(existing_face['descriptor'])
                distance = np.linalg.norm(new_descriptor - existing_descriptor)
                distances.append(distance)
            
            # Use multiple distance metrics for robustness
            min_distance = min(distances)
            
            # Calculate match quality based on multiple factors
            if len(distances) >= 3:
                # If 3+ faces: use average of best 3 matches
                distances_sorted = sorted(distances)
                avg_top3 = sum(distances_sorted[:3]) / 3
                final_distance = (min_distance * 0.6 + avg_top3 * 0.4)  # Weighted average
                match_quality = "high_confidence"
            elif len(distances) >= 2:
                # If 2 faces: use average of both
                avg_top2 = sum(sorted(distances)[:2]) / 2
                final_distance = (min_distance * 0.7 + avg_top2 * 0.3)
                match_quality = "medium_confidence"
            else:
                # Single face: use minimum distance but be more lenient
                final_distance = min_distance
                match_quality = "low_confidence"
            
            logger.info(f"Person {person.get('name', person['id'][:8])}: distance = {final_distance:.4f}, min = {min_distance:.4f}, quality = {match_quality}")
            
            # Track best overall match
            if final_distance < best_distance:
                best_distance = final_distance
                best_match = person
                best_match_quality = match_quality
    
    # Use tiered threshold approach
    matched = False
    if best_match:
        # Primary threshold: strict matching
        if best_distance < primary_threshold:
            matched = True
            logger.info(f"✅ PRIMARY MATCH! Person {best_match.get('name', best_match['id'][:8])} with distance {best_distance:.4f}")
        # Secondary threshold: for cases with accessories (glasses, etc)
        elif best_distance < secondary_threshold and best_match_quality in ["high_confidence", "medium_confidence"]:
            matched = True
            logger.info(f"✅ SECONDARY MATCH (accessories/variation)! Person {best_match.get('name', best_match['id'][:8])} with distance {best_distance:.4f}")
    
    if matched:
        return best_match['id'], False
    
    # No match found, create new person
    logger.info(f"❌ No match found (best distance: {best_distance:.4f}, primary threshold: {primary_threshold}, secondary: {secondary_threshold}), creating new person")
    person = Person(
        user_id=user_id,
        photo_count=0,  # Will be calculated properly in the calling function
        sample_photo_url=sample_photo_url,
        sample_file_id=file_id
    )
    person_dict = person.model_dump()
    person_dict['created_at'] = person_dict['created_at'].isoformat()
    person_dict['updated_at'] = person_dict['updated_at'].isoformat()
    await db.people.insert_one(person_dict)
    
    logger.info(f"Created new person {person.id}")
    return person.id, True


@api_router.get("/people", response_model=List[Person])
async def list_people(current_user: User = Depends(get_current_user)):
    """List all detected people"""
    people = await db.people.find({"user_id": current_user.id}, {"_id": 0}).to_list(1000)
    for person in people:
        if isinstance(person.get('created_at'), str):
            person['created_at'] = datetime.fromisoformat(person['created_at'])
        if isinstance(person.get('updated_at'), str):
            person['updated_at'] = datetime.fromisoformat(person['updated_at'])
    return people


@api_router.put("/people/{person_id}/name")
async def update_person_name(person_id: str, update: PersonUpdate, current_user: User = Depends(get_current_user)):
    """Update person name"""
    result = await db.people.update_one(
        {"id": person_id, "user_id": current_user.id},
        {"$set": {
            "name": update.name,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Person not found")
    return {"success": True}


@api_router.get("/people/{person_id}/photos")
async def get_person_photos(person_id: str, current_user: User = Depends(get_current_user)):
    """Get all photos containing this person"""
    # Verify person belongs to user
    person = await db.people.find_one({"id": person_id, "user_id": current_user.id})
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    
    # Get all face detections for this person
    faces = await db.faces.find({"person_id": person_id, "user_id": current_user.id}, {"_id": 0}).to_list(1000)
    
    # Get unique file IDs
    file_ids = list(set([face['file_id'] for face in faces]))
    
    # Get file metadata for these files
    files = await db.files.find(
        {"id": {"$in": file_ids}, "user_id": current_user.id, "is_trashed": False},
        {"_id": 0}
    ).to_list(1000)
    
    for f in files:
        if isinstance(f['created_at'], str):
            f['created_at'] = datetime.fromisoformat(f['created_at'])
    
    return files


@api_router.post("/people/merge")
async def merge_people(merge: PersonMerge, current_user: User = Depends(get_current_user)):
    """Merge multiple people into one (for fixing duplicate detections)"""
    # Verify all people belong to user
    people = await db.people.find(
        {"id": {"$in": merge.person_ids + [merge.target_person_id]}, "user_id": current_user.id}
    ).to_list(1000)
    
    if len(people) != len(merge.person_ids) + 1:
        raise HTTPException(status_code=404, detail="One or more people not found")
    
    # Update all faces from source people to target person
    await db.faces.update_many(
        {"person_id": {"$in": merge.person_ids}, "user_id": current_user.id},
        {"$set": {"person_id": merge.target_person_id}}
    )
    
    # Recalculate photo count for target person
    face_count = await db.faces.count_documents({"person_id": merge.target_person_id, "user_id": current_user.id})
    await db.people.update_one(
        {"id": merge.target_person_id},
        {"$set": {
            "photo_count": face_count,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    # Delete source people
    await db.people.delete_many({"id": {"$in": merge.person_ids}, "user_id": current_user.id})
    
    return {"success": True}


@api_router.delete("/people/{person_id}")
async def delete_person(person_id: str, current_user: User = Depends(get_current_user)):
    """Delete a person and unlink their face data"""
    # Verify person belongs to user
    person = await db.people.find_one({"id": person_id, "user_id": current_user.id})
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    
    # Unlink faces (set person_id to None)
    await db.faces.update_many(
        {"person_id": person_id, "user_id": current_user.id},
        {"$set": {"person_id": None}}
    )
    
    # Delete person
    await db.people.delete_one({"id": person_id, "user_id": current_user.id})
    
    return {"success": True}


# ========== HELPER FUNCTIONS FOR FILE DELETION ==========

async def permanently_delete_file(file: dict, user: User):
    """Permanently delete file from Telegram and thumbnail storage"""
    try:
        # Delete from Telegram
        if user.telegram_bot_token and file.get('telegram_msg_id'):
            try:
                response = requests.post(
                    f"https://api.telegram.org/bot{user.telegram_bot_token}/deleteMessage",
                    json={
                        "chat_id": user.telegram_channel_id,
                        "message_id": file['telegram_msg_id']
                    }
                )
                if response.json().get('ok'):
                    logger.info(f"Deleted Telegram message {file['telegram_msg_id']}")
                else:
                    logger.warning(f"Failed to delete Telegram message: {response.json()}")
            except Exception as e:
                logger.error(f"Error deleting from Telegram: {str(e)}")
        
        # Delete from ImgBB (if applicable)
        # Note: ImgBB doesn't provide a delete API for free tier
        # Thumbnail will remain but won't be accessible from our app
        
        # Delete face data associated with this file
        await db.faces.delete_many({"file_id": file['id']})
        
    except Exception as e:
        logger.error(f"Error in permanently_delete_file: {str(e)}")


async def cleanup_old_trash():
    """Background task to cleanup files in trash for more than 10 days"""
    try:
        logger.info("Running trash cleanup task...")
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=10)
        
        # Find all files trashed more than 10 days ago
        cursor = db.files.find({
            "is_trashed": True,
            "trashed_at": {"$ne": None, "$lt": cutoff_date.isoformat()}
        })
        
        files_to_delete = await cursor.to_list(None)
        
        if files_to_delete:
            logger.info(f"Found {len(files_to_delete)} files to permanently delete")
            
            for file in files_to_delete:
                try:
                    # Get user info
                    user = await db.users.find_one({"id": file['user_id']})
                    if user:
                        user_obj = User(**user)
                        await permanently_delete_file(file, user_obj)
                    
                    # Delete from database
                    await db.files.delete_one({"id": file['id']})
                    logger.info(f"Permanently deleted file {file['id']}")
                except Exception as e:
                    logger.error(f"Error deleting file {file['id']}: {str(e)}")
        else:
            logger.info("No files to cleanup")
            
    except Exception as e:
        logger.error(f"Error in cleanup_old_trash: {str(e)}")


# ========== BULK OPERATIONS ENDPOINTS ==========

@api_router.post("/files/bulk-delete")
async def bulk_delete_files(request: BulkDeleteRequest, current_user: User = Depends(get_current_user)):
    """Move multiple files to trash"""
    if not request.file_ids:
        raise HTTPException(status_code=400, detail="No file IDs provided")
    
    try:
        result = await db.files.update_many(
            {"id": {"$in": request.file_ids}, "user_id": current_user.id},
            {"$set": {"is_trashed": True, "trashed_at": datetime.now(timezone.utc).isoformat()}}
        )
        
        return {
            "success": True,
            "deleted_count": result.modified_count
        }
    except Exception as e:
        logger.error(f"Bulk delete error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@api_router.post("/files/bulk-share")
async def bulk_share_files(request: BulkShareRequest, current_user: User = Depends(get_current_user)):
    """Generate share link for multiple files as a collection"""
    if not request.file_ids:
        raise HTTPException(status_code=400, detail="No file IDs provided")
    
    try:
        # Verify all files belong to the user
        files = await db.files.find({
            "id": {"$in": request.file_ids},
            "user_id": current_user.id
        }).to_list(None)
        
        if len(files) != len(request.file_ids):
            raise HTTPException(status_code=404, detail="Some files not found")
        
        # If only one file, use single file share
        if len(request.file_ids) == 1:
            share_token = str(uuid.uuid4())
            await db.files.update_one(
                {"id": request.file_ids[0], "user_id": current_user.id},
                {"$set": {"is_public": True, "share_token": share_token}}
            )
            return {
                "success": True,
                "share_type": "single",
                "share_url": f"/share/{share_token}",
                "share_token": share_token
            }
        
        # For multiple files, create a shared collection
        share_token = str(uuid.uuid4())
        collection = SharedCollection(
            user_id=current_user.id,
            file_ids=request.file_ids,
            share_token=share_token
        )
        
        collection_dict = collection.model_dump()
        collection_dict['created_at'] = collection_dict['created_at'].isoformat()
        await db.shared_collections.insert_one(collection_dict)
        
        # Mark all files as public
        await db.files.update_many(
            {"id": {"$in": request.file_ids}, "user_id": current_user.id},
            {"$set": {"is_public": True}}
        )
        
        return {
            "success": True,
            "share_type": "collection",
            "share_url": f"/share/collection/{share_token}",
            "share_token": share_token,
            "file_count": len(request.file_ids)
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Bulk share error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@api_router.post("/files/trash/clear-all")
async def clear_all_trash(current_user: User = Depends(get_current_user)):
    """Permanently delete all files in trash"""
    try:
        logger.info(f"Clear trash requested by user {current_user.id}")
        
        # Get all trashed files
        trashed_files = await db.files.find({
            "user_id": current_user.id,
            "is_trashed": True
        }).to_list(None)
        
        logger.info(f"Found {len(trashed_files)} files in trash")
        
        deleted_count = 0
        for file in trashed_files:
            try:
                logger.info(f"Deleting file {file['id']}: {file.get('name', 'Unknown')}")
                await permanently_delete_file(file, current_user)
                await db.files.delete_one({"id": file['id']})
                deleted_count += 1
            except Exception as e:
                logger.error(f"Error deleting file {file['id']}: {str(e)}")
        
        logger.info(f"Successfully deleted {deleted_count} files")
        
        return {
            "success": True,
            "deleted_count": deleted_count
        }
    except Exception as e:
        logger.error(f"Clear trash error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Include router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize background scheduler for trash cleanup
scheduler = AsyncIOScheduler()

@app.on_event("startup")
async def startup_scheduler():
    """Start background scheduler for trash cleanup"""
    try:
        # Run cleanup every hour
        scheduler.add_job(
            cleanup_old_trash,
            trigger=IntervalTrigger(hours=1),
            id='trash_cleanup',
            name='Clean up old trash files',
            replace_existing=True
        )
        scheduler.start()
        logger.info("Background scheduler started - trash cleanup will run every hour")
    except Exception as e:
        logger.error(f"Failed to start scheduler: {str(e)}")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
    # Shutdown scheduler
    if scheduler.running:
        scheduler.shutdown()
    # Cleanup telegram clients
    for session_data in telegram_clients.values():
        try:
            await session_data['client'].disconnect()
        except:
            pass
