#!/usr/bin/env python3
"""
TeleStore Backend API Testing Suite
Tests the automatic credential management feature
"""

import requests
import json
import sys
import os
from datetime import datetime

# Get backend URL from frontend .env file
def get_backend_url():
    try:
        with open('/app/frontend/.env', 'r') as f:
            for line in f:
                if line.startswith('REACT_APP_BACKEND_URL='):
                    return line.split('=', 1)[1].strip()
    except:
        pass
    return "http://localhost:8001"

BASE_URL = get_backend_url() + "/api"
print(f"Testing backend at: {BASE_URL}")

class TeleStoreAPITester:
    def __init__(self):
        self.session = requests.Session()
        self.auth_token = None
        self.test_user_email = "testuser@telestore.com"
        self.test_user_password = "TestPassword123!"
        self.results = []
        
    def log_result(self, test_name, success, message, details=None):
        """Log test result"""
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} {test_name}: {message}")
        if details:
            print(f"   Details: {details}")
        
        self.results.append({
            'test': test_name,
            'success': success,
            'message': message,
            'details': details,
            'timestamp': datetime.now().isoformat()
        })
    
    def test_signup(self):
        """Test user signup endpoint"""
        try:
            payload = {
                "email": self.test_user_email,
                "password": self.test_user_password
            }
            
            response = self.session.post(f"{BASE_URL}/auth/signup", json=payload)
            
            if response.status_code == 200:
                data = response.json()
                if 'access_token' in data and 'token_type' in data:
                    self.auth_token = data['access_token']
                    self.log_result("User Signup", True, "Successfully created user and received token")
                    return True
                else:
                    self.log_result("User Signup", False, "Missing token in response", data)
                    return False
            elif response.status_code == 400 and "already registered" in response.text:
                # User already exists, try login instead
                self.log_result("User Signup", True, "User already exists (expected)", response.text)
                return self.test_login()
            else:
                self.log_result("User Signup", False, f"HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("User Signup", False, f"Request failed: {str(e)}")
            return False
    
    def test_login(self):
        """Test user login endpoint"""
        try:
            payload = {
                "email": self.test_user_email,
                "password": self.test_user_password
            }
            
            response = self.session.post(f"{BASE_URL}/auth/login", json=payload)
            
            if response.status_code == 200:
                data = response.json()
                if 'access_token' in data and 'token_type' in data:
                    self.auth_token = data['access_token']
                    self.log_result("User Login", True, "Successfully logged in and received token")
                    return True
                else:
                    self.log_result("User Login", False, "Missing token in response", data)
                    return False
            else:
                self.log_result("User Login", False, f"HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("User Login", False, f"Request failed: {str(e)}")
            return False
    
    def test_auth_me(self):
        """Test /auth/me endpoint"""
        if not self.auth_token:
            self.log_result("Auth Me", False, "No auth token available")
            return False
            
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            response = self.session.get(f"{BASE_URL}/auth/me", headers=headers)
            
            if response.status_code == 200:
                data = response.json()
                if 'email' in data and data['email'] == self.test_user_email:
                    self.log_result("Auth Me", True, "Successfully retrieved user profile")
                    return True
                else:
                    self.log_result("Auth Me", False, "Invalid user data returned", data)
                    return False
            else:
                self.log_result("Auth Me", False, f"HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("Auth Me", False, f"Request failed: {str(e)}")
            return False
    
    def test_worker_credentials_not_configured(self):
        """Test /worker/credentials endpoint when Telegram not configured"""
        if not self.auth_token:
            self.log_result("Worker Credentials (Not Configured)", False, "No auth token available")
            return False
            
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            response = self.session.get(f"{BASE_URL}/worker/credentials", headers=headers)
            
            if response.status_code == 400:
                data = response.json()
                if "not fully configured" in data.get('detail', '').lower():
                    self.log_result("Worker Credentials (Not Configured)", True, "Correctly returned 400 for unconfigured Telegram")
                    return True
                else:
                    self.log_result("Worker Credentials (Not Configured)", False, "Wrong error message", data)
                    return False
            else:
                self.log_result("Worker Credentials (Not Configured)", False, f"Expected 400, got HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("Worker Credentials (Not Configured)", False, f"Request failed: {str(e)}")
            return False
    
    def test_bot_token_invalid(self):
        """Test /settings/bot-token endpoint with invalid token"""
        if not self.auth_token:
            self.log_result("Bot Token (Invalid)", False, "No auth token available")
            return False
            
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            payload = {"bot_token": "invalid_bot_token_123"}
            
            response = self.session.post(f"{BASE_URL}/settings/bot-token", json=payload, headers=headers)
            
            if response.status_code == 400:
                data = response.json()
                if "invalid" in data.get('detail', '').lower():
                    self.log_result("Bot Token (Invalid)", True, "Correctly rejected invalid bot token")
                    return True
                else:
                    self.log_result("Bot Token (Invalid)", False, "Wrong error message", data)
                    return False
            else:
                self.log_result("Bot Token (Invalid)", False, f"Expected 400, got HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("Bot Token (Invalid)", False, f"Request failed: {str(e)}")
            return False
    
    def test_bot_token_format_validation(self):
        """Test bot token format validation"""
        if not self.auth_token:
            self.log_result("Bot Token Format Validation", False, "No auth token available")
            return False
            
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            
            # Test various invalid formats
            invalid_tokens = [
                "",  # Empty
                "123",  # Too short
                "not_a_token",  # Wrong format
                "123:ABC",  # Too short bot ID
            ]
            
            for token in invalid_tokens:
                payload = {"bot_token": token}
                response = self.session.post(f"{BASE_URL}/settings/bot-token", json=payload, headers=headers)
                
                if response.status_code != 400:
                    self.log_result("Bot Token Format Validation", False, f"Should reject token '{token}', got HTTP {response.status_code}")
                    return False
            
            self.log_result("Bot Token Format Validation", True, "Correctly validates bot token formats")
            return True
                
        except Exception as e:
            self.log_result("Bot Token Format Validation", False, f"Request failed: {str(e)}")
            return False
    
    def test_valid_bot_token_format(self):
        """Test with a valid-looking bot token format (will fail at Telegram API validation)"""
        if not self.auth_token:
            self.log_result("Valid Bot Token Format", False, "No auth token available")
            return False
            
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            # Use a valid format but fake token (10 digits:35 chars)
            fake_valid_token = "1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi"
            payload = {"bot_token": fake_valid_token}
            
            response = self.session.post(f"{BASE_URL}/settings/bot-token", json=payload, headers=headers)
            
            # Should get 400 because token is invalid at Telegram API level
            if response.status_code == 400:
                data = response.json()
                if "invalid" in data.get('detail', '').lower():
                    self.log_result("Valid Bot Token Format", True, "Correctly validates token with Telegram API")
                    return True
                else:
                    self.log_result("Valid Bot Token Format", False, "Wrong error message", data)
                    return False
            else:
                self.log_result("Valid Bot Token Format", False, f"Expected 400, got HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("Valid Bot Token Format", False, f"Request failed: {str(e)}")
            return False
    
    def test_unauthorized_access(self):
        """Test endpoints without authentication"""
        try:
            # Test worker credentials without auth
            response = self.session.get(f"{BASE_URL}/worker/credentials")
            if response.status_code not in [401, 403]:
                self.log_result("Unauthorized Access", False, f"Worker credentials should require auth, got HTTP {response.status_code}")
                return False
            
            # Test bot token without auth
            response = self.session.post(f"{BASE_URL}/settings/bot-token", json={"bot_token": "test"})
            if response.status_code not in [401, 403]:
                self.log_result("Unauthorized Access", False, f"Bot token endpoint should require auth, got HTTP {response.status_code}")
                return False
            
            # Test auth/me without auth
            response = self.session.get(f"{BASE_URL}/auth/me")
            if response.status_code not in [401, 403]:
                self.log_result("Unauthorized Access", False, f"Auth/me should require auth, got HTTP {response.status_code}")
                return False
            
            self.log_result("Unauthorized Access", True, "All protected endpoints correctly require authentication")
            return True
                
        except Exception as e:
            self.log_result("Unauthorized Access", False, f"Request failed: {str(e)}")
            return False
    
    def test_backend_connectivity(self):
        """Test basic backend connectivity"""
        try:
            # Try to reach the backend
            response = self.session.get(BASE_URL.replace('/api', '/'))
            if response.status_code in [200, 404, 422]:  # Any response means backend is up
                self.log_result("Backend Connectivity", True, f"Backend is reachable (HTTP {response.status_code})")
                return True
            else:
                self.log_result("Backend Connectivity", False, f"Unexpected response: HTTP {response.status_code}")
                return False
                
        except Exception as e:
            self.log_result("Backend Connectivity", False, f"Cannot reach backend: {str(e)}")
            return False
    
    # ========== FACE RECOGNITION TESTS ==========
    
    def create_test_file(self):
        """Create a test file for face recognition tests"""
        if not self.auth_token:
            return None
            
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            payload = {
                "name": "test_photo.jpg",
                "size": 1024000,
                "mime_type": "image/jpeg",
                "telegram_msg_id": 12345,
                "telegram_file_id": "test_file_id_123",
                "thumbnail_url": "https://example.com/thumb.jpg"
            }
            
            response = self.session.post(f"{BASE_URL}/files", json=payload, headers=headers)
            
            if response.status_code == 200:
                data = response.json()
                return data.get('id')
            else:
                self.log_result("Create Test File", False, f"HTTP {response.status_code}", response.text)
                return None
                
        except Exception as e:
            self.log_result("Create Test File", False, f"Request failed: {str(e)}")
            return None
    
    def test_store_face_data(self):
        """Test POST /api/faces - Store face detection data"""
        if not self.auth_token:
            self.log_result("Store Face Data", False, "No auth token available")
            return False
        
        # Create a test file first
        file_id = self.create_test_file()
        if not file_id:
            self.log_result("Store Face Data", False, "Could not create test file")
            return False
            
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            
            # Mock face descriptors (128-dimensional float arrays)
            face_descriptor_1 = [0.1] * 128  # Simple mock descriptor
            face_descriptor_2 = [0.9] * 128  # Different mock descriptor
            
            payload = {
                "file_id": file_id,
                "detections": [
                    {
                        "box": {"x": 100, "y": 150, "width": 80, "height": 100},
                        "descriptor": face_descriptor_1,
                        "confidence": 0.95
                    },
                    {
                        "box": {"x": 300, "y": 200, "width": 75, "height": 95},
                        "descriptor": face_descriptor_2,
                        "confidence": 0.88
                    }
                ]
            }
            
            response = self.session.post(f"{BASE_URL}/faces", json=payload, headers=headers)
            
            if response.status_code == 200:
                data = response.json()
                if data.get('success') and 'face_ids' in data:
                    self.log_result("Store Face Data", True, f"Successfully stored {len(data['face_ids'])} faces")
                    return True
                else:
                    self.log_result("Store Face Data", False, "Invalid response format", data)
                    return False
            else:
                self.log_result("Store Face Data", False, f"HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("Store Face Data", False, f"Request failed: {str(e)}")
            return False
    
    def test_store_face_data_invalid_file(self):
        """Test POST /api/faces with non-existent file_id"""
        if not self.auth_token:
            self.log_result("Store Face Data (Invalid File)", False, "No auth token available")
            return False
            
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            
            payload = {
                "file_id": "non_existent_file_id",
                "detections": [
                    {
                        "box": {"x": 100, "y": 150, "width": 80, "height": 100},
                        "descriptor": [0.1] * 128,
                        "confidence": 0.95
                    }
                ]
            }
            
            response = self.session.post(f"{BASE_URL}/faces", json=payload, headers=headers)
            
            if response.status_code == 404:
                self.log_result("Store Face Data (Invalid File)", True, "Correctly rejected non-existent file")
                return True
            else:
                self.log_result("Store Face Data (Invalid File)", False, f"Expected 404, got HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("Store Face Data (Invalid File)", False, f"Request failed: {str(e)}")
            return False
    
    def test_list_people(self):
        """Test GET /api/people - List all detected people"""
        if not self.auth_token:
            self.log_result("List People", False, "No auth token available")
            return False
            
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            response = self.session.get(f"{BASE_URL}/people", headers=headers)
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    self.log_result("List People", True, f"Successfully retrieved {len(data)} people")
                    return True
                else:
                    self.log_result("List People", False, "Response is not a list", data)
                    return False
            else:
                self.log_result("List People", False, f"HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("List People", False, f"Request failed: {str(e)}")
            return False
    
    def test_list_people_unauthorized(self):
        """Test GET /api/people without authentication"""
        try:
            response = self.session.get(f"{BASE_URL}/people")
            
            if response.status_code in [401, 403]:
                self.log_result("List People (Unauthorized)", True, "Correctly requires authentication")
                return True
            else:
                self.log_result("List People (Unauthorized)", False, f"Expected 401/403, got HTTP {response.status_code}")
                return False
                
        except Exception as e:
            self.log_result("List People (Unauthorized)", False, f"Request failed: {str(e)}")
            return False
    
    def get_or_create_person_for_testing(self):
        """Helper method to get or create a person for testing"""
        if not self.auth_token:
            return None
            
        # First try to get existing people
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            response = self.session.get(f"{BASE_URL}/people", headers=headers)
            
            if response.status_code == 200:
                people = response.json()
                if people:
                    return people[0]['id']  # Return first person's ID
            
            # If no people exist, create face data which will create a person
            file_id = self.create_test_file()
            if file_id:
                payload = {
                    "file_id": file_id,
                    "detections": [
                        {
                            "box": {"x": 100, "y": 150, "width": 80, "height": 100},
                            "descriptor": [0.5] * 128,
                            "confidence": 0.95
                        }
                    ]
                }
                
                response = self.session.post(f"{BASE_URL}/faces", json=payload, headers=headers)
                if response.status_code == 200:
                    # Now get the created person
                    response = self.session.get(f"{BASE_URL}/people", headers=headers)
                    if response.status_code == 200:
                        people = response.json()
                        if people:
                            return people[0]['id']
            
            return None
                
        except Exception:
            return None
    
    def test_update_person_name(self):
        """Test PUT /api/people/{person_id}/name - Update person name"""
        if not self.auth_token:
            self.log_result("Update Person Name", False, "No auth token available")
            return False
        
        person_id = self.get_or_create_person_for_testing()
        if not person_id:
            self.log_result("Update Person Name", False, "Could not get/create person for testing")
            return False
            
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            payload = {"name": "John Doe"}
            
            response = self.session.put(f"{BASE_URL}/people/{person_id}/name", json=payload, headers=headers)
            
            if response.status_code == 200:
                data = response.json()
                if data.get('success'):
                    self.log_result("Update Person Name", True, "Successfully updated person name")
                    return True
                else:
                    self.log_result("Update Person Name", False, "Invalid response format", data)
                    return False
            else:
                self.log_result("Update Person Name", False, f"HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("Update Person Name", False, f"Request failed: {str(e)}")
            return False
    
    def test_update_person_name_invalid_id(self):
        """Test PUT /api/people/{person_id}/name with invalid person_id"""
        if not self.auth_token:
            self.log_result("Update Person Name (Invalid ID)", False, "No auth token available")
            return False
            
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            payload = {"name": "John Doe"}
            
            response = self.session.put(f"{BASE_URL}/people/invalid_person_id/name", json=payload, headers=headers)
            
            if response.status_code == 404:
                self.log_result("Update Person Name (Invalid ID)", True, "Correctly returned 404 for invalid person ID")
                return True
            else:
                self.log_result("Update Person Name (Invalid ID)", False, f"Expected 404, got HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("Update Person Name (Invalid ID)", False, f"Request failed: {str(e)}")
            return False
    
    def test_get_person_photos(self):
        """Test GET /api/people/{person_id}/photos - Get photos for a person"""
        if not self.auth_token:
            self.log_result("Get Person Photos", False, "No auth token available")
            return False
        
        person_id = self.get_or_create_person_for_testing()
        if not person_id:
            self.log_result("Get Person Photos", False, "Could not get/create person for testing")
            return False
            
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            response = self.session.get(f"{BASE_URL}/people/{person_id}/photos", headers=headers)
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    self.log_result("Get Person Photos", True, f"Successfully retrieved {len(data)} photos for person")
                    return True
                else:
                    self.log_result("Get Person Photos", False, "Response is not a list", data)
                    return False
            else:
                self.log_result("Get Person Photos", False, f"HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("Get Person Photos", False, f"Request failed: {str(e)}")
            return False
    
    def test_get_person_photos_invalid_id(self):
        """Test GET /api/people/{person_id}/photos with invalid person_id"""
        if not self.auth_token:
            self.log_result("Get Person Photos (Invalid ID)", False, "No auth token available")
            return False
            
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            response = self.session.get(f"{BASE_URL}/people/invalid_person_id/photos", headers=headers)
            
            if response.status_code == 404:
                self.log_result("Get Person Photos (Invalid ID)", True, "Correctly returned 404 for invalid person ID")
                return True
            else:
                self.log_result("Get Person Photos (Invalid ID)", False, f"Expected 404, got HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("Get Person Photos (Invalid ID)", False, f"Request failed: {str(e)}")
            return False
    
    def create_multiple_people_for_merge_test(self):
        """Helper to create multiple people for merge testing"""
        if not self.auth_token:
            return None, None
            
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            
            # Create two different files with different face descriptors
            file_id_1 = self.create_test_file()
            file_id_2 = self.create_test_file()
            
            if not file_id_1 or not file_id_2:
                return None, None
            
            # Create faces with different descriptors to create separate people
            payload_1 = {
                "file_id": file_id_1,
                "detections": [
                    {
                        "box": {"x": 100, "y": 150, "width": 80, "height": 100},
                        "descriptor": [0.1] * 128,  # First unique descriptor
                        "confidence": 0.95
                    }
                ]
            }
            
            payload_2 = {
                "file_id": file_id_2,
                "detections": [
                    {
                        "box": {"x": 200, "y": 250, "width": 85, "height": 105},
                        "descriptor": [0.9] * 128,  # Second unique descriptor (very different)
                        "confidence": 0.92
                    }
                ]
            }
            
            # Store both face detections
            response_1 = self.session.post(f"{BASE_URL}/faces", json=payload_1, headers=headers)
            response_2 = self.session.post(f"{BASE_URL}/faces", json=payload_2, headers=headers)
            
            if response_1.status_code == 200 and response_2.status_code == 200:
                # Get the people list to find the created person IDs
                response = self.session.get(f"{BASE_URL}/people", headers=headers)
                if response.status_code == 200:
                    people = response.json()
                    if len(people) >= 2:
                        return people[0]['id'], people[1]['id']
            
            return None, None
                
        except Exception:
            return None, None
    
    def test_merge_people(self):
        """Test POST /api/people/merge - Merge duplicate people"""
        if not self.auth_token:
            self.log_result("Merge People", False, "No auth token available")
            return False
        
        person_id_1, person_id_2 = self.create_multiple_people_for_merge_test()
        if not person_id_1 or not person_id_2:
            self.log_result("Merge People", False, "Could not create multiple people for testing")
            return False
            
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            payload = {
                "person_ids": [person_id_2],  # Source person to merge
                "target_person_id": person_id_1  # Target person to merge into
            }
            
            response = self.session.post(f"{BASE_URL}/people/merge", json=payload, headers=headers)
            
            if response.status_code == 200:
                data = response.json()
                if data.get('success'):
                    self.log_result("Merge People", True, "Successfully merged people")
                    return True
                else:
                    self.log_result("Merge People", False, "Invalid response format", data)
                    return False
            else:
                self.log_result("Merge People", False, f"HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("Merge People", False, f"Request failed: {str(e)}")
            return False
    
    def test_merge_people_invalid_ids(self):
        """Test POST /api/people/merge with invalid person IDs"""
        if not self.auth_token:
            self.log_result("Merge People (Invalid IDs)", False, "No auth token available")
            return False
            
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            payload = {
                "person_ids": ["invalid_id_1", "invalid_id_2"],
                "target_person_id": "invalid_target_id"
            }
            
            response = self.session.post(f"{BASE_URL}/people/merge", json=payload, headers=headers)
            
            if response.status_code == 404:
                self.log_result("Merge People (Invalid IDs)", True, "Correctly returned 404 for invalid person IDs")
                return True
            else:
                self.log_result("Merge People (Invalid IDs)", False, f"Expected 404, got HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("Merge People (Invalid IDs)", False, f"Request failed: {str(e)}")
            return False
    
    def test_delete_person(self):
        """Test DELETE /api/people/{person_id} - Delete person"""
        if not self.auth_token:
            self.log_result("Delete Person", False, "No auth token available")
            return False
        
        person_id = self.get_or_create_person_for_testing()
        if not person_id:
            self.log_result("Delete Person", False, "Could not get/create person for testing")
            return False
            
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            response = self.session.delete(f"{BASE_URL}/people/{person_id}", headers=headers)
            
            if response.status_code == 200:
                data = response.json()
                if data.get('success'):
                    self.log_result("Delete Person", True, "Successfully deleted person")
                    return True
                else:
                    self.log_result("Delete Person", False, "Invalid response format", data)
                    return False
            else:
                self.log_result("Delete Person", False, f"HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("Delete Person", False, f"Request failed: {str(e)}")
            return False
    
    def test_delete_person_invalid_id(self):
        """Test DELETE /api/people/{person_id} with invalid person_id"""
        if not self.auth_token:
            self.log_result("Delete Person (Invalid ID)", False, "No auth token available")
            return False
            
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            response = self.session.delete(f"{BASE_URL}/people/invalid_person_id", headers=headers)
            
            if response.status_code == 404:
                self.log_result("Delete Person (Invalid ID)", True, "Correctly returned 404 for invalid person ID")
                return True
            else:
                self.log_result("Delete Person (Invalid ID)", False, f"Expected 404, got HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("Delete Person (Invalid ID)", False, f"Request failed: {str(e)}")
            return False
    
    def test_face_matching_algorithm(self):
        """Test that similar faces get grouped to same person"""
        if not self.auth_token:
            self.log_result("Face Matching Algorithm", False, "No auth token available")
            return False
        
        # Create a test file
        file_id = self.create_test_file()
        if not file_id:
            self.log_result("Face Matching Algorithm", False, "Could not create test file")
            return False
            
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            
            # Create two very similar face descriptors (should match)
            similar_descriptor_1 = [0.5] * 128
            similar_descriptor_2 = [0.51] * 128  # Very similar to first one
            
            # Store first face
            payload_1 = {
                "file_id": file_id,
                "detections": [
                    {
                        "box": {"x": 100, "y": 150, "width": 80, "height": 100},
                        "descriptor": similar_descriptor_1,
                        "confidence": 0.95
                    }
                ]
            }
            
            response_1 = self.session.post(f"{BASE_URL}/faces", json=payload_1, headers=headers)
            
            if response_1.status_code != 200:
                self.log_result("Face Matching Algorithm", False, "Failed to store first face")
                return False
            
            # Get people count after first face
            people_response = self.session.get(f"{BASE_URL}/people", headers=headers)
            if people_response.status_code != 200:
                self.log_result("Face Matching Algorithm", False, "Failed to get people list")
                return False
            
            people_count_1 = len(people_response.json())
            
            # Store second similar face
            payload_2 = {
                "file_id": file_id,
                "detections": [
                    {
                        "box": {"x": 200, "y": 250, "width": 85, "height": 105},
                        "descriptor": similar_descriptor_2,
                        "confidence": 0.92
                    }
                ]
            }
            
            response_2 = self.session.post(f"{BASE_URL}/faces", json=payload_2, headers=headers)
            
            if response_2.status_code != 200:
                self.log_result("Face Matching Algorithm", False, "Failed to store second face")
                return False
            
            # Get people count after second face
            people_response = self.session.get(f"{BASE_URL}/people", headers=headers)
            if people_response.status_code != 200:
                self.log_result("Face Matching Algorithm", False, "Failed to get people list after second face")
                return False
            
            people_count_2 = len(people_response.json())
            
            # Similar faces should be grouped to same person (no new person created)
            if people_count_2 == people_count_1:
                self.log_result("Face Matching Algorithm", True, "Similar faces correctly grouped to same person")
                return True
            else:
                self.log_result("Face Matching Algorithm", False, f"Expected same person count, got {people_count_1} -> {people_count_2}")
                return False
                
        except Exception as e:
            self.log_result("Face Matching Algorithm", False, f"Request failed: {str(e)}")
            return False
    
    # ========== BULK SHARE TESTS ==========
    
    def create_multiple_test_files(self, count=3):
        """Create multiple test files for bulk operations"""
        if not self.auth_token:
            return []
            
        file_ids = []
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            
            for i in range(count):
                payload = {
                    "name": f"test_photo_{i+1}.jpg",
                    "size": 1024000 + i * 1000,  # Slightly different sizes
                    "mime_type": "image/jpeg",
                    "telegram_msg_id": 12345 + i,
                    "telegram_file_id": f"test_file_id_{i+1}",
                    "thumbnail_url": f"https://example.com/thumb_{i+1}.jpg"
                }
                
                response = self.session.post(f"{BASE_URL}/files", json=payload, headers=headers)
                
                if response.status_code == 200:
                    data = response.json()
                    file_ids.append(data.get('id'))
                else:
                    self.log_result("Create Multiple Test Files", False, f"Failed to create file {i+1}: HTTP {response.status_code}")
                    return []
            
            return file_ids
                
        except Exception as e:
            self.log_result("Create Multiple Test Files", False, f"Request failed: {str(e)}")
            return []
    
    def test_bulk_share_single_file(self):
        """Test POST /api/files/bulk-share with single file (backward compatibility)"""
        if not self.auth_token:
            self.log_result("Bulk Share Single File", False, "No auth token available")
            return False
        
        # Create a single test file
        file_ids = self.create_multiple_test_files(1)
        if not file_ids:
            self.log_result("Bulk Share Single File", False, "Could not create test file")
            return False
            
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            payload = {"file_ids": file_ids}
            
            response = self.session.post(f"{BASE_URL}/files/bulk-share", json=payload, headers=headers)
            
            if response.status_code == 200:
                data = response.json()
                expected_fields = ['success', 'share_type', 'share_url', 'share_token']
                
                if all(field in data for field in expected_fields):
                    if data['share_type'] == 'single' and data['success']:
                        self.log_result("Bulk Share Single File", True, "Single file share works correctly (backward compatibility)")
                        return True
                    else:
                        self.log_result("Bulk Share Single File", False, f"Wrong share_type or success flag: {data}")
                        return False
                else:
                    self.log_result("Bulk Share Single File", False, f"Missing required fields in response: {data}")
                    return False
            else:
                self.log_result("Bulk Share Single File", False, f"HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("Bulk Share Single File", False, f"Request failed: {str(e)}")
            return False
    
    def test_bulk_share_multiple_files(self):
        """Test POST /api/files/bulk-share with multiple files (collection)"""
        if not self.auth_token:
            self.log_result("Bulk Share Multiple Files", False, "No auth token available")
            return False
        
        # Create multiple test files
        file_ids = self.create_multiple_test_files(3)
        if len(file_ids) != 3:
            self.log_result("Bulk Share Multiple Files", False, "Could not create 3 test files")
            return False
            
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            payload = {"file_ids": file_ids}
            
            response = self.session.post(f"{BASE_URL}/files/bulk-share", json=payload, headers=headers)
            
            if response.status_code == 200:
                data = response.json()
                expected_fields = ['success', 'share_type', 'share_url', 'share_token', 'file_count']
                
                if all(field in data for field in expected_fields):
                    if (data['share_type'] == 'collection' and 
                        data['success'] and 
                        data['file_count'] == 3 and
                        '/share/collection/' in data['share_url']):
                        self.log_result("Bulk Share Multiple Files", True, f"Collection created successfully with {data['file_count']} files")
                        # Store share_token for subsequent tests
                        self.collection_share_token = data['share_token']
                        self.collection_file_ids = file_ids
                        return True
                    else:
                        self.log_result("Bulk Share Multiple Files", False, f"Invalid collection data: {data}")
                        return False
                else:
                    self.log_result("Bulk Share Multiple Files", False, f"Missing required fields in response: {data}")
                    return False
            else:
                self.log_result("Bulk Share Multiple Files", False, f"HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("Bulk Share Multiple Files", False, f"Request failed: {str(e)}")
            return False
    
    def test_bulk_share_empty_list(self):
        """Test POST /api/files/bulk-share with empty file list"""
        if not self.auth_token:
            self.log_result("Bulk Share Empty List", False, "No auth token available")
            return False
            
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            payload = {"file_ids": []}
            
            response = self.session.post(f"{BASE_URL}/files/bulk-share", json=payload, headers=headers)
            
            if response.status_code == 400:
                data = response.json()
                if "no file ids" in data.get('detail', '').lower():
                    self.log_result("Bulk Share Empty List", True, "Correctly rejected empty file list")
                    return True
                else:
                    self.log_result("Bulk Share Empty List", False, f"Wrong error message: {data}")
                    return False
            else:
                self.log_result("Bulk Share Empty List", False, f"Expected 400, got HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("Bulk Share Empty List", False, f"Request failed: {str(e)}")
            return False
    
    def test_bulk_share_nonexistent_files(self):
        """Test POST /api/files/bulk-share with non-existent file IDs"""
        if not self.auth_token:
            self.log_result("Bulk Share Nonexistent Files", False, "No auth token available")
            return False
            
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            payload = {"file_ids": ["nonexistent_id_1", "nonexistent_id_2"]}
            
            response = self.session.post(f"{BASE_URL}/files/bulk-share", json=payload, headers=headers)
            
            if response.status_code == 404:
                data = response.json()
                if "not found" in data.get('detail', '').lower():
                    self.log_result("Bulk Share Nonexistent Files", True, "Correctly rejected non-existent files")
                    return True
                else:
                    self.log_result("Bulk Share Nonexistent Files", False, f"Wrong error message: {data}")
                    return False
            else:
                self.log_result("Bulk Share Nonexistent Files", False, f"Expected 404, got HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("Bulk Share Nonexistent Files", False, f"Request failed: {str(e)}")
            return False
    
    def test_get_shared_collection(self):
        """Test GET /api/share/collection/{token} - Get collection with all files"""
        # This test depends on test_bulk_share_multiple_files running first
        if not hasattr(self, 'collection_share_token'):
            self.log_result("Get Shared Collection", False, "No collection share token available (run bulk share test first)")
            return False
            
        try:
            response = self.session.get(f"{BASE_URL}/share/collection/{self.collection_share_token}")
            
            if response.status_code == 200:
                data = response.json()
                expected_fields = ['collection', 'files', 'file_count']
                
                if all(field in data for field in expected_fields):
                    collection = data['collection']
                    files = data['files']
                    file_count = data['file_count']
                    
                    if (isinstance(files, list) and 
                        file_count == len(files) and 
                        file_count == 3 and
                        'share_token' in collection and
                        'file_ids' in collection):
                        self.log_result("Get Shared Collection", True, f"Successfully retrieved collection with {file_count} files")
                        return True
                    else:
                        self.log_result("Get Shared Collection", False, f"Invalid collection structure: files={len(files)}, count={file_count}")
                        return False
                else:
                    self.log_result("Get Shared Collection", False, f"Missing required fields in response: {data}")
                    return False
            else:
                self.log_result("Get Shared Collection", False, f"HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("Get Shared Collection", False, f"Request failed: {str(e)}")
            return False
    
    def test_get_shared_collection_invalid_token(self):
        """Test GET /api/share/collection/{token} with invalid token"""
        try:
            response = self.session.get(f"{BASE_URL}/share/collection/invalid_token_123")
            
            if response.status_code == 404:
                data = response.json()
                if "not found" in data.get('detail', '').lower():
                    self.log_result("Get Shared Collection (Invalid Token)", True, "Correctly returned 404 for invalid token")
                    return True
                else:
                    self.log_result("Get Shared Collection (Invalid Token)", False, f"Wrong error message: {data}")
                    return False
            else:
                self.log_result("Get Shared Collection (Invalid Token)", False, f"Expected 404, got HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("Get Shared Collection (Invalid Token)", False, f"Request failed: {str(e)}")
            return False
    
    def test_get_collection_file_download_url(self):
        """Test GET /api/share/collection/{token}/file/{file_id}/download-url"""
        # This test depends on previous tests
        if not hasattr(self, 'collection_share_token') or not hasattr(self, 'collection_file_ids'):
            self.log_result("Get Collection File Download URL", False, "No collection data available (run previous tests first)")
            return False
            
        try:
            # Use the first file from the collection
            file_id = self.collection_file_ids[0]
            response = self.session.get(f"{BASE_URL}/share/collection/{self.collection_share_token}/file/{file_id}/download-url")
            
            if response.status_code == 200:
                data = response.json()
                expected_fields = ['download_url', 'file_name']
                
                if all(field in data for field in expected_fields):
                    download_url = data['download_url']
                    file_name = data['file_name']
                    
                    if download_url and file_name:
                        self.log_result("Get Collection File Download URL", True, f"Successfully got download URL for file: {file_name}")
                        return True
                    else:
                        self.log_result("Get Collection File Download URL", False, f"Empty download_url or file_name: {data}")
                        return False
                else:
                    self.log_result("Get Collection File Download URL", False, f"Missing required fields in response: {data}")
                    return False
            elif response.status_code == 400:
                # This is expected if bot token is not configured or file_id is missing
                data = response.json()
                if "bot token not configured" in data.get('detail', '').lower() or "unable to generate" in data.get('detail', '').lower():
                    self.log_result("Get Collection File Download URL", True, "Correctly handled missing bot token/file_id (expected in test environment)")
                    return True
                else:
                    self.log_result("Get Collection File Download URL", False, f"Unexpected 400 error: {data}")
                    return False
            else:
                self.log_result("Get Collection File Download URL", False, f"HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("Get Collection File Download URL", False, f"Request failed: {str(e)}")
            return False
    
    def test_get_collection_file_download_url_invalid_file(self):
        """Test GET /api/share/collection/{token}/file/{file_id}/download-url with file not in collection"""
        if not hasattr(self, 'collection_share_token'):
            self.log_result("Get Collection File Download URL (Invalid File)", False, "No collection share token available")
            return False
            
        try:
            # Use a non-existent file ID
            response = self.session.get(f"{BASE_URL}/share/collection/{self.collection_share_token}/file/invalid_file_id/download-url")
            
            if response.status_code == 404:
                data = response.json()
                if "not in this collection" in data.get('detail', '').lower() or "not found" in data.get('detail', '').lower():
                    self.log_result("Get Collection File Download URL (Invalid File)", True, "Correctly rejected file not in collection")
                    return True
                else:
                    self.log_result("Get Collection File Download URL (Invalid File)", False, f"Wrong error message: {data}")
                    return False
            else:
                self.log_result("Get Collection File Download URL (Invalid File)", False, f"Expected 404, got HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("Get Collection File Download URL (Invalid File)", False, f"Request failed: {str(e)}")
            return False
    
    def test_bulk_share_unauthorized(self):
        """Test POST /api/files/bulk-share without authentication"""
        try:
            payload = {"file_ids": ["test_id_1", "test_id_2"]}
            response = self.session.post(f"{BASE_URL}/files/bulk-share", json=payload)
            
            if response.status_code in [401, 403]:
                self.log_result("Bulk Share (Unauthorized)", True, "Correctly requires authentication")
                return True
            else:
                self.log_result("Bulk Share (Unauthorized)", False, f"Expected 401/403, got HTTP {response.status_code}")
                return False
                
        except Exception as e:
            self.log_result("Bulk Share (Unauthorized)", False, f"Request failed: {str(e)}")
            return False

    def run_all_tests(self):
        """Run all tests in sequence"""
        print("=" * 60)
        print("TeleStore Backend API Test Suite")
        print("=" * 60)
        
        tests = [
            ("Backend Connectivity", self.test_backend_connectivity),
            ("Unauthorized Access", self.test_unauthorized_access),
            ("User Signup", self.test_signup),
            ("User Login", self.test_login),
            ("Auth Me", self.test_auth_me),
            ("Worker Credentials (Not Configured)", self.test_worker_credentials_not_configured),
            ("Bot Token (Invalid)", self.test_bot_token_invalid),
            ("Bot Token Format Validation", self.test_bot_token_format_validation),
            ("Valid Bot Token Format", self.test_valid_bot_token_format),
            # Bulk Share Feature Tests
            ("Bulk Share (Unauthorized)", self.test_bulk_share_unauthorized),
            ("Bulk Share Empty List", self.test_bulk_share_empty_list),
            ("Bulk Share Nonexistent Files", self.test_bulk_share_nonexistent_files),
            ("Bulk Share Single File", self.test_bulk_share_single_file),
            ("Bulk Share Multiple Files", self.test_bulk_share_multiple_files),
            ("Get Shared Collection", self.test_get_shared_collection),
            ("Get Shared Collection (Invalid Token)", self.test_get_shared_collection_invalid_token),
            ("Get Collection File Download URL", self.test_get_collection_file_download_url),
            ("Get Collection File Download URL (Invalid File)", self.test_get_collection_file_download_url_invalid_file),
        ]
        
        passed = 0
        total = len(tests)
        
        for test_name, test_func in tests:
            print(f"\n--- Running: {test_name} ---")
            if test_func():
                passed += 1
        
        print("\n" + "=" * 60)
        print(f"TEST SUMMARY: {passed}/{total} tests passed")
        print("=" * 60)
        
        # Print failed tests
        failed_tests = [r for r in self.results if not r['success']]
        if failed_tests:
            print("\nFAILED TESTS:")
            for test in failed_tests:
                print(f"❌ {test['test']}: {test['message']}")
                if test['details']:
                    print(f"   Details: {test['details']}")
        
        return passed == total

if __name__ == "__main__":
    tester = TeleStoreAPITester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)