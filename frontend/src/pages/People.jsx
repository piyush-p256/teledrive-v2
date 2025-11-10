import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API } from '../App';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../components/ui/dialog';
import { toast } from 'sonner';
import {
  User,
  Users,
  ArrowLeft,
  Edit2,
  Settings,
  LogOut,
  X,
} from 'lucide-react';
import ImageGalleryModal from '../components/ImageGalleryModal';

export default function People({ user, onLogout }) {
  const navigate = useNavigate();
  const [people, setPeople] = useState([]);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [personPhotos, setPersonPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [renameDialog, setRenameDialog] = useState(false);
  const [renamePerson, setRenamePerson] = useState(null);
  const [newName, setNewName] = useState('');
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryPhotos, setGalleryPhotos] = useState([]);
  const [galleryInitialIndex, setGalleryInitialIndex] = useState(0);

  useEffect(() => {
    loadPeople();
  }, []);

  const loadPeople = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API}/people`);
      setPeople(response.data);
    } catch (error) {
      toast.error('Failed to load people');
    } finally {
      setLoading(false);
    }
  };

  const handlePersonClick = async (person) => {
    try {
      setSelectedPerson(person);
      setPhotosLoading(true);
      const response = await axios.get(`${API}/people/${person.id}/photos`);
      setPersonPhotos(response.data);
    } catch (error) {
      toast.error('Failed to load photos');
    } finally {
      setPhotosLoading(false);
    }
  };

  const handleRename = async () => {
    if (!newName.trim()) return;

    try {
      await axios.put(`${API}/people/${renamePerson.id}/name`, { name: newName });
      toast.success('Name updated successfully');
      setRenameDialog(false);
      setNewName('');
      loadPeople();
      
      // Update selected person if it's the one being renamed
      if (selectedPerson?.id === renamePerson.id) {
        setSelectedPerson({ ...selectedPerson, name: newName });
      }
    } catch (error) {
      toast.error('Failed to update name');
    }
  };

  const handleDeletePerson = async (personId) => {
    if (!window.confirm('Are you sure you want to delete this person? Face data will be unlinked but photos will remain.')) {
      return;
    }

    try {
      await axios.delete(`${API}/people/${personId}`);
      toast.success('Person deleted');
      loadPeople();
      if (selectedPerson?.id === personId) {
        setSelectedPerson(null);
        setPersonPhotos([]);
      }
    } catch (error) {
      toast.error('Failed to delete person');
    }
  };

  const getPersonDisplayName = (person, index) => {
    return person.name || `Person ${index + 1}`;
  };

  const handlePhotoClick = (photoIndex) => {
    setGalleryPhotos(personPhotos);
    setGalleryInitialIndex(photoIndex);
    setGalleryOpen(true);
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/dashboard')}
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="p-2 bg-indigo-600 rounded-lg">
                <Users className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-indigo-600" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                People
              </h1>
            </div>

            <div className="flex items-center space-x-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/settings')}
              >
                <Settings className="w-5 h-5" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={onLogout}
              >
                <LogOut className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* People List */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-lg shadow-sm p-4">
                <h2 className="text-lg font-semibold mb-4">
                  All People ({people.length})
                </h2>
                
                {people.length === 0 ? (
                  <div className="text-center py-12">
                    <User className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500">
                      No people detected yet. Upload some photos with faces to get started!
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {people.map((person, index) => (
                      <Card
                        key={person.id}
                        className={`p-3 cursor-pointer hover:shadow-md transition-shadow ${
                          selectedPerson?.id === person.id ? 'ring-2 ring-indigo-500' : ''
                        }`}
                        onClick={() => handlePersonClick(person)}
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-12 h-12 rounded-full overflow-hidden bg-gray-200 flex-shrink-0">
                            {person.sample_photo_url ? (
                              <img
                                src={person.sample_photo_url}
                                alt={getPersonDisplayName(person, index)}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <User className="w-6 h-6 text-gray-400" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">
                              {getPersonDisplayName(person, index)}
                            </p>
                            <p className="text-xs text-gray-500">
                              {person.photo_count} {person.photo_count === 1 ? 'photo' : 'photos'}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="flex-shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenamePerson(person);
                              setNewName(person.name || '');
                              setRenameDialog(true);
                            }}
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Photos Grid */}
            <div className="lg:col-span-2">
              {selectedPerson ? (
                <div className="bg-white rounded-lg shadow-sm p-4">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-lg font-semibold">
                        {getPersonDisplayName(selectedPerson, people.findIndex(p => p.id === selectedPerson.id))}
                      </h2>
                      <p className="text-sm text-gray-500">
                        {personPhotos.length} {personPhotos.length === 1 ? 'photo' : 'photos'}
                      </p>
                    </div>
                    <div className="flex space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setRenamePerson(selectedPerson);
                          setNewName(selectedPerson.name || '');
                          setRenameDialog(true);
                        }}
                      >
                        <Edit2 className="w-4 h-4 mr-2" />
                        Rename
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeletePerson(selectedPerson.id)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <X className="w-4 h-4 mr-2" />
                        Delete
                      </Button>
                    </div>
                  </div>

                  {photosLoading ? (
                    <div className="flex items-center justify-center h-64">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {personPhotos.map((photo, index) => (
                        <Card
                          key={photo.id}
                          className="overflow-hidden cursor-pointer hover:shadow-lg transition-shadow"
                          onClick={() => handlePhotoClick(index)}
                        >
                          <div className="aspect-square bg-gray-100 flex items-center justify-center">
                            {photo.thumbnail_url ? (
                              <img
                                src={photo.thumbnail_url}
                                alt={photo.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <User className="w-12 h-12 text-gray-400" />
                            )}
                          </div>
                          <div className="p-2">
                            <p className="text-xs truncate font-medium" title={photo.name}>
                              {photo.name}
                            </p>
                            <p className="text-xs text-gray-500">{formatFileSize(photo.size)}</p>
                          </div>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-white rounded-lg shadow-sm p-8">
                  <div className="text-center">
                    <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">
                      Select a person
                    </h3>
                    <p className="text-gray-500">
                      Click on a person from the list to see all their photos
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Rename Dialog */}
      <Dialog open={renameDialog} onOpenChange={setRenameDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Name this person</DialogTitle>
            <DialogDescription>
              Give this person a name to easily identify them
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Enter name"
            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleRename}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image Gallery Modal */}
      {galleryOpen && (
        <ImageGalleryModal
          photos={galleryPhotos}
          initialIndex={galleryInitialIndex}
          onClose={() => setGalleryOpen(false)}
        />
      )}
    </div>
  );
}
