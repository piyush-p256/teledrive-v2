# Render Web Service for TeleStore File Upload
# Deploy this as a Web Service on Render

from flask import Flask, request, jsonify
import requests
import os
from datetime import datetime, timedelta

app = Flask(__name__)

# Configuration - only set BACKEND_URL, credentials will be fetched automatically
CONFIG = {
    'BACKEND_URL': os.environ.get('BACKEND_URL', 'https://your-telestore-backend.com'),
    'MAX_FILE_SIZE': 2000 * 1024 * 1024,
    'CACHE_DURATION': 3600,  # 1 hour in seconds
}

# In-memory cache for credentials
credentials_cache = {
    'data': None,
    'timestamp': None,
    'user_id': None
}

def get_credentials(user_id, auth_token):
    """Fetch credentials from backend or return cached version"""
    now = datetime.now()
    
    # Return cached credentials if still valid and for same user
    if (credentials_cache['data'] and 
        credentials_cache['user_id'] == user_id and
        credentials_cache['timestamp'] and
        (now - credentials_cache['timestamp']).total_seconds() < CONFIG['CACHE_DURATION']):
        return credentials_cache['data']
    
    # Fetch fresh credentials from backend
    try:
        response = requests.get(
            f"{CONFIG['BACKEND_URL']}/api/worker/credentials",
            headers={'Authorization': f'Bearer {auth_token}'}
        )
        
        if response.status_code != 200:
            raise Exception(f"Failed to fetch credentials: {response.text}")
        
        credentials = response.json()
        
        # Cache the credentials
        credentials_cache['data'] = credentials
        credentials_cache['timestamp'] = now
        credentials_cache['user_id'] = user_id
        
        return credentials
    except Exception as e:
        # If cache exists, use it even if expired (fallback)
        if credentials_cache['data'] and credentials_cache['user_id'] == user_id:
            print(f'Using expired cache due to fetch error: {e}')
            return credentials_cache['data']
        raise e

# CORS helper function
def add_cors_headers(response):
    """Add CORS headers to response"""
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'POST, GET, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    return response

# Chunked upload storage (in-memory, can be replaced with Redis for production)
chunk_storage = {}

@app.route('/init-upload', methods=['POST', 'OPTIONS'])
def init_upload():
    """Initialize chunked upload"""
    if request.method == 'OPTIONS':
        return add_cors_headers(jsonify({}))
    
    try:
        data = request.get_json()
        upload_id = data.get('uploadId')
        file_name = data.get('fileName')
        total_chunks = data.get('totalChunks')
        
        # Initialize upload session
        chunk_storage[upload_id] = {
            'fileName': file_name,
            'totalChunks': total_chunks,
            'chunks': {},
            'timestamp': datetime.now()
        }
        
        return add_cors_headers(jsonify({
            'success': True,
            'uploadId': upload_id
        }))
    except Exception as e:
        return add_cors_headers(jsonify({'error': str(e)})), 500

@app.route('/upload-chunk', methods=['POST', 'OPTIONS'])
def upload_chunk():
    """Upload a single chunk"""
    if request.method == 'OPTIONS':
        return add_cors_headers(jsonify({}))
    
    try:
        upload_id = request.form.get('uploadId')
        chunk_index = int(request.form.get('chunkIndex'))
        chunk_file = request.files.get('chunk')
        
        if not chunk_file:
            return add_cors_headers(jsonify({'error': 'No chunk provided'})), 400
        
        if upload_id not in chunk_storage:
            return add_cors_headers(jsonify({'error': 'Upload session not found'})), 404
        
        # Store chunk data
        chunk_storage[upload_id]['chunks'][chunk_index] = chunk_file.read()
        
        return add_cors_headers(jsonify({
            'success': True,
            'chunkIndex': chunk_index,
            'uploadedChunks': len(chunk_storage[upload_id]['chunks'])
        }))
    except Exception as e:
        return add_cors_headers(jsonify({'error': str(e)})), 500

@app.route('/complete-upload', methods=['POST', 'OPTIONS'])
def complete_upload():
    """Complete chunked upload and send to Telegram"""
    if request.method == 'OPTIONS':
        return add_cors_headers(jsonify({}))
    
    try:
        data = request.get_json()
        upload_id = data.get('uploadId')
        user_id = data.get('userId')
        auth_token = data.get('authToken')
        
        if upload_id not in chunk_storage:
            return add_cors_headers(jsonify({'error': 'Upload session not found'})), 404
        
        upload_session = chunk_storage[upload_id]
        file_name = upload_session['fileName']
        total_chunks = upload_session['totalChunks']
        
        # Check if all chunks are uploaded
        if len(upload_session['chunks']) != total_chunks:
            return add_cors_headers(jsonify({
                'error': f'Missing chunks. Expected {total_chunks}, got {len(upload_session["chunks"])}'
            })), 400
        
        # Reassemble file
        file_data = b''.join([upload_session['chunks'][i] for i in range(total_chunks)])
        file_size = len(file_data)
        
        # Fetch credentials from backend
        credentials = get_credentials(user_id, auth_token)
        
        # Upload to Telegram
        files = {
            'document': (file_name, file_data, 'application/octet-stream')
        }
        data_payload = {
            'chat_id': credentials['channel_id'],
            'caption': f'Uploaded: {file_name}'
        }
        
        telegram_response = requests.post(
            f"https://api.telegram.org/bot{credentials['bot_token']}/sendDocument",
            files=files,
            data=data_payload
        )
        
        telegram_result = telegram_response.json()
        
        if not telegram_result.get('ok'):
            raise Exception(telegram_result.get('description', 'Telegram upload failed'))
        
        message_id = telegram_result['result']['message_id']
        result = telegram_result['result']
        file_id = (
            result.get('document', {}).get('file_id') or
            result.get('video', {}).get('file_id') or
            result.get('audio', {}).get('file_id') or
            (result.get('photo', [{}])[0].get('file_id') if result.get('photo') else None)
        )
        
        if not file_id:
            raise Exception('Failed to get file_id from Telegram response')
        
        # Clean up chunk storage
        del chunk_storage[upload_id]
        
        # Notify backend
        requests.post(
            f"{CONFIG['BACKEND_URL']}/api/webhook/upload",
            json={
                'userId': user_id,
                'fileName': file_name,
                'messageId': message_id,
                'fileId': file_id,
                'size': file_size,
                'mimeType': 'application/octet-stream',
            }
        )
        
        return add_cors_headers(jsonify({
            'success': True,
            'messageId': message_id,
            'fileId': file_id,
            'fileName': file_name,
        }))
    except Exception as e:
        return add_cors_headers(jsonify({'error': str(e)})), 500

@app.route('/upload', methods=['POST', 'OPTIONS'])
def upload_file():
    # Handle CORS
    if request.method == 'OPTIONS':
        return add_cors_headers(jsonify({}))
    
    try:
        file = request.files.get('file')
        user_id = request.form.get('userId')
        auth_token = request.form.get('authToken')  # User's auth token for fetching credentials
        file_name = request.form.get('fileName') or file.filename
        
        if not file:
            return jsonify({'error': 'No file provided'}), 400
        
        if not auth_token:
            return jsonify({'error': 'Auth token required'}), 400
        
        # Check file size
        file.seek(0, 2)
        file_size = file.tell()
        file.seek(0)
        
        if file_size > CONFIG['MAX_FILE_SIZE']:
            return jsonify({'error': 'File too large (max 2GB)'}), 400
        
        # Fetch credentials from backend (or use cache)
        credentials = get_credentials(user_id, auth_token)
        
        # Upload to Telegram
        files = {
            'document': (file_name, file.read(), file.content_type)
        }
        data = {
            'chat_id': credentials['channel_id'],
            'caption': f'Uploaded: {file_name}'
        }
        
        telegram_response = requests.post(
            f"https://api.telegram.org/bot{credentials['bot_token']}/sendDocument",
            files=files,
            data=data
        )
        
        telegram_result = telegram_response.json()
        
        if not telegram_result.get('ok'):
            raise Exception(telegram_result.get('description', 'Telegram upload failed'))
        
        message_id = telegram_result['result']['message_id']
        
        # Telegram returns different properties based on file type
        # Videos: result['video'], Documents: result['document'], Audio: result['audio'], Photos: result['photo']
        result = telegram_result['result']
        file_id = (
            result.get('document', {}).get('file_id') or
            result.get('video', {}).get('file_id') or
            result.get('audio', {}).get('file_id') or
            (result.get('photo', [{}])[0].get('file_id') if result.get('photo') else None)
        )
        
        if not file_id:
            raise Exception('Failed to get file_id from Telegram response')
        
        # Notify backend
        requests.post(
            f"{CONFIG['BACKEND_URL']}/api/webhook/upload",
            json={
                'userId': user_id,
                'fileName': file_name,
                'messageId': message_id,
                'fileId': file_id,
                'size': file_size,
                'mimeType': file.content_type,
            }
        )
        
        return add_cors_headers(jsonify({
            'success': True,
            'messageId': message_id,
            'fileId': file_id,
            'fileName': file_name,
        }))
        
    except Exception as e:
        return add_cors_headers(jsonify({'error': str(e)})), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 10000)))
