import React, { useState, useEffect, useCallback } from 'react';
import { Camera, Sparkles, Image as ImageIcon, Download, RefreshCw, AlertCircle, Monitor, Smartphone, Zap, Grid, Heart, Trash2, Film, Plus, Wand2, X, Play } from 'lucide-react';
import { generateImageFromPrompt, generateVideoFromImage } from './services/geminiService';
import { DEFAULT_PROMPT } from './constants';

// Local interface to type the aistudio object when accessed via type assertion
interface AIStudioClient {
  hasSelectedApiKey: () => Promise<boolean>;
  openSelectKey: () => Promise<void>;
}

interface SavedMedia {
  id: string;
  userEmail: string; 
  url: string;
  thumbnailUrl?: string; 
  type: 'image' | 'video';
  prompt: string;
  date: number;
  aspectRatio: string;
}

interface PromptEnhancer {
  id: string;
  label: string;
  value: string;
  category: 'lighting' | 'camera' | 'texture';
}

const PROMPT_ENHANCERS: PromptEnhancer[] = [
  { id: 'light_golden', label: '☀️ Luz Dourada', value: ', iluminação golden hour intensa, raios de sol volumétricos, calor visual', category: 'lighting' },
  { id: 'light_soft', label: '☁️ Luz Suave', value: ', luz difusa de janela, sombras suaves, iluminação naturalista e calma', category: 'lighting' },
  { id: 'cam_macro', label: '🔍 Detalhes Macro', value: ', close-up extremo, foco nos detalhes dos olhos e pele, macro photography', category: 'camera' },
  { id: 'cam_85mm', label: '📸 Retrato 85mm', value: ', lente 85mm f/1.8, fundo desfocado cremoso (bokeh), foco nítido no sujeito', category: 'camera' },
  { id: 'tex_skin', label: '✨ Pele Realista', value: ', textura de pele ultra realista, poros visíveis, imperfeições naturais, sem filtro', category: 'texture' },
  { id: 'tex_fabric', label: '🧶 Texturas Ricas', value: ', tecidos táteis, linho amassado, lã detalhada, madeira com veio visível', category: 'texture' },
];

const ANIMATION_PRESETS = [
  { id: 'natural', label: '🌿 Natural', prompt: 'Movimento natural e cinematográfico, brisa suave, respiração calma, iluminação mudando sutilmente.' },
  { id: 'wind', label: '🍃 Vento na janela', prompt: 'Vento suave entrando pela janela, movendo as cortinas e as folhas das plantas delicadamente. Luz do sol dinâmica.' },
  { id: 'blanket', label: '🛌 Ajustar Manta', prompt: 'A mãe ajusta delicadamente a manta sobre a criança com cuidado e ternura.' },
  { id: 'stroke', label: '✋ Carinho', prompt: 'A mãe passa a mão suavemente na cabeça da criança, num gesto de conforto.' },
  { id: 'book', label: '📖 Ler Livro', prompt: 'A mãe vira a página do livro lentamente enquanto observa a criança.' },
];

// Fallback API key provided by user
const FALLBACK_API_KEY = 'AIzaSyAjQmY4qoW5yYNGfM-S9syM2SHnuh63yZM';

const App: React.FC = () => {
  // App State
  const [activeTab, setActiveTab] = useState<'studio' | 'collection'>('studio');
  const [hasKey, setHasKey] = useState<boolean>(false);
  const [isCheckingKey, setIsCheckingKey] = useState<boolean>(true);

  // Generator State
  const [prompt, setPrompt] = useState<string>(DEFAULT_PROMPT);
  const [aspectRatio, setAspectRatio] = useState<string>("16:9");
  const [resolution, setResolution] = useState<string>("2K");
  const [model, setModel] = useState<string>("gemini-3-pro-image-preview");
  
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [generatedVideo, setGeneratedVideo] = useState<string | null>(null);
  
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isAnimating, setIsAnimating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Animation Modal State
  const [showVideoPrompt, setShowVideoPrompt] = useState(false);
  const [videoPrompt, setVideoPrompt] = useState('');

  // Gallery State
  const [savedMedia, setSavedMedia] = useState<SavedMedia[]>([]);
  const [storageError, setStorageError] = useState<string | null>(null);

  // --- Initialization & Auth ---

  // Helper to safely access aistudio from window
  const getAiStudio = (): AIStudioClient | undefined => {
    return (window as any).aistudio;
  };

  const checkKey = useCallback(async () => {
    try {
      const aiStudio = getAiStudio();
      let studioHasKey = false;
      if (aiStudio) {
        studioHasKey = await aiStudio.hasSelectedApiKey();
      }
      
      const keyAvailable = studioHasKey || !!process.env.API_KEY || !!FALLBACK_API_KEY;
      setHasKey(keyAvailable);
    } catch (e) {
      console.error("Error checking API key status:", e);
      setHasKey(!!process.env.API_KEY || !!FALLBACK_API_KEY);
    } finally {
      setIsCheckingKey(false);
    }
  }, []);

  const loadGallery = () => {
    try {
      const allMediaJSON = localStorage.getItem('serene_gallery_db');
      if (allMediaJSON) {
        const allMedia: SavedMedia[] = JSON.parse(allMediaJSON);
        // Migration support: Add type='image' if missing
        const normalizedMedia = allMedia.map(item => ({
          ...item,
          type: item.type || 'image'
        }));
        // Load all media for the local user context
        setSavedMedia(normalizedMedia);
      } else {
        setSavedMedia([]);
      }
    } catch (e) {
      console.warn("Could not load gallery", e);
    }
  };

  useEffect(() => {
    checkKey();
    loadGallery();
  }, [checkKey]);

  // --- API Key Handling ---

  const handleConnectKey = async () => {
    setError(null);
    const aiStudio = getAiStudio();
    if (aiStudio) {
      try {
        await aiStudio.openSelectKey();
        setHasKey(true); 
      } catch (e) {
        console.error("Error opening key selector:", e);
        setError("Failed to connect API Key. Please try again.");
      }
    } else {
      if (process.env.API_KEY || FALLBACK_API_KEY) {
         setHasKey(true);
      } else {
         setError("AI Studio environment not detected. Ensure API_KEY is set in your environment.");
      }
    }
  };

  // --- Content Generation ---

  const handleAddEnhancer = (enhancer: PromptEnhancer) => {
    // Check if already present to avoid duplicates
    if (!prompt.includes(enhancer.value.trim())) {
      setPrompt(prev => prev.trim() + " " + enhancer.value);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    
    setIsLoading(true);
    setError(null);
    setGeneratedImage(null);
    setGeneratedVideo(null);
    
    try {
      const imageUrl = await generateImageFromPrompt(prompt, aspectRatio, resolution, model);
      setGeneratedImage(imageUrl);
    } catch (err: any) {
      console.error("Generation error:", err);
      const errorMessage = err.message || String(err);
      
      if (errorMessage.includes("Requested entity was not found") || errorMessage.includes("403") || errorMessage.includes("PERMISSION_DENIED")) {
        if (!FALLBACK_API_KEY) {
           setHasKey(false);
        }
        setError("API Key invalid or does not have permission. Please try another key.");
      } else {
        setError(errorMessage || "An unexpected error occurred while generating the image.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleVideoGeneration = async () => {
    if (!generatedImage) return;
    
    setShowVideoPrompt(false); // Close modal
    setIsAnimating(true);
    setError(null);
    setGeneratedVideo(null);

    // Default prompt if empty
    const finalPrompt = videoPrompt.trim() || "Movimento natural e cinematográfico, brisa suave, respiração calma, iluminação mudando sutilmente.";

    try {
      const videoUrl = await generateVideoFromImage(finalPrompt, generatedImage, aspectRatio);
      setGeneratedVideo(videoUrl);
    } catch (err: any) {
      console.error("Video generation error:", err);
       const errorMessage = err.message || String(err);
      
      if (errorMessage.includes("Requested entity was not found") || errorMessage.includes("404")) {
         setError("Video generation requires a Paid API Key (Veo model). Please connect a valid key.");
      } else {
         setError(errorMessage);
      }
    } finally {
      setIsAnimating(false);
    }
  };

  // --- Gallery Actions ---

  const handleSaveToGallery = (type: 'image' | 'video' = 'image') => {
    const urlToSave = type === 'video' ? generatedVideo : generatedImage;
    if (!urlToSave) return;

    const newMedia: SavedMedia = {
      id: Date.now().toString(),
      userEmail: 'guest',
      url: urlToSave,
      type: type,
      prompt: type === 'video' ? (videoPrompt || prompt) : prompt,
      date: Date.now(),
      aspectRatio: aspectRatio
    };

    // Update UI
    const updatedUserGallery = [newMedia, ...savedMedia];
    setSavedMedia(updatedUserGallery);

    // Update "Database"
    try {
      // Get entire DB
      const allMediaJSON = localStorage.getItem('serene_gallery_db');
      const allMedia: SavedMedia[] = allMediaJSON ? JSON.parse(allMediaJSON) : [];
      
      // Add new image
      const updatedDB = [newMedia, ...allMedia];
      
      localStorage.setItem('serene_gallery_db', JSON.stringify(updatedDB));
      setStorageError(null);
    } catch (e) {
      console.error("Storage quota exceeded", e);
      setStorageError("Storage full. Item saved for this session only.");
    }
  };

  const handleDeleteMedia = (id: string) => {
    // Update UI
    const updatedUserGallery = savedMedia.filter(img => img.id !== id);
    setSavedMedia(updatedUserGallery);

    // Update DB
    try {
      const allMediaJSON = localStorage.getItem('serene_gallery_db');
      if (allMediaJSON) {
        const allMedia: SavedMedia[] = JSON.parse(allMediaJSON);
        const updatedDB = allMedia.filter(img => img.id !== id);
        localStorage.setItem('serene_gallery_db', JSON.stringify(updatedDB));
      }
    } catch (e) {
      // Ignore
    }
  };

  const handleDownload = (url: string, id?: string, type: 'image' | 'video' = 'image') => {
    const link = document.createElement('a');
    link.href = url;
    link.download = `serene-lens-${id || Date.now()}.${type === 'video' ? 'mp4' : 'png'}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- Render Helpers ---

  if (isCheckingKey) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="animate-pulse flex flex-col items-center">
          <div className="h-12 w-12 bg-stone-200 rounded-full mb-4"></div>
          <div className="h-4 w-32 bg-stone-200 rounded"></div>
        </div>
      </div>
    );
  }

  // Main App
  return (
    <div className="min-h-screen bg-stone-50 text-stone-800 font-sans pb-12 relative">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-stone-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="h-6 w-6 text-stone-700" />
            <span className="font-serif text-xl font-medium tracking-tight text-stone-900 hidden sm:inline">Serene Lens</span>
          </div>
          
          <nav className="flex items-center gap-1 bg-stone-100/50 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('studio')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${activeTab === 'studio' ? 'bg-white shadow-sm text-stone-900' : 'text-stone-500 hover:text-stone-700'}`}
            >
              <Sparkles className="h-4 w-4" />
              Studio
            </button>
            <button
              onClick={() => setActiveTab('collection')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${activeTab === 'collection' ? 'bg-white shadow-sm text-stone-900' : 'text-stone-500 hover:text-stone-700'}`}
            >
              <Grid className="h-4 w-4" />
              Collection <span className="opacity-60 text-xs ml-0.5">({savedMedia.length})</span>
            </button>
          </nav>

          <div className="flex items-center gap-4">
             {/* API Key Status Indicator */}
             <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${hasKey ? 'bg-green-500' : 'bg-amber-500'}`}></div>
                <span className="text-xs text-stone-500 font-medium">{hasKey ? 'Ready' : 'Setup'}</span>
             </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-8 space-y-8">
        {!hasKey && (
           <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 flex items-center justify-between">
             <div className="flex items-center gap-3">
               <AlertCircle className="h-5 w-5 text-amber-600" />
               <p className="text-amber-800 text-sm">To generate high-quality images and videos, please connect a valid paid API Key.</p>
             </div>
             <button onClick={handleConnectKey} className="text-sm font-medium text-amber-900 hover:underline">Connect Key</button>
           </div>
        )}

        {/* Studio View */}
        {activeTab === 'studio' && (
          <div className="space-y-8 animate-in fade-in duration-500">
             {/* Input Section */}
            <section className="bg-white rounded-3xl shadow-sm border border-stone-100 overflow-hidden">
              <div className="p-6 sm:p-8 space-y-6">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="prompt" className="block text-sm font-semibold text-stone-700 uppercase tracking-wider">
                      Image Description
                    </label>
                    <button 
                      onClick={() => setPrompt(DEFAULT_PROMPT)} 
                      className="text-xs text-stone-400 hover:text-stone-600 flex items-center gap-1 transition-colors"
                    >
                      <RefreshCw className="h-3 w-3" /> Reset Prompt
                    </button>
                  </div>
                  <textarea
                    id="prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="w-full min-h-[140px] p-4 bg-stone-50 border-0 rounded-xl text-stone-800 placeholder-stone-400 focus:ring-2 focus:ring-stone-200 focus:bg-white transition-all resize-y text-base leading-relaxed"
                    placeholder="Describe your scene in detail..."
                  />
                  
                  {/* Enhancers Chips */}
                  <div className="pt-2">
                    <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-stone-400 uppercase tracking-wider">
                      <Wand2 className="h-3 w-3" />
                      Refinar Detalhes (Quick Enhance)
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {PROMPT_ENHANCERS.map((enhancer) => (
                        <button
                          key={enhancer.id}
                          onClick={() => handleAddEnhancer(enhancer)}
                          className="px-3 py-1.5 rounded-lg border border-stone-200 text-xs font-medium text-stone-600 hover:bg-stone-50 hover:text-stone-900 hover:border-stone-300 transition-all flex items-center gap-1.5"
                        >
                          {enhancer.label}
                          <Plus className="h-3 w-3 opacity-50" />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col xl:flex-row items-center justify-between gap-4 pt-2 border-t border-stone-50 mt-4">
                  <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500 w-full xl:w-auto pt-4 xl:pt-0">
                     {/* Controls */}
                     <div className="flex items-center bg-stone-100 p-1 rounded-lg">
                        <button onClick={() => setAspectRatio("16:9")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all font-medium ${aspectRatio === "16:9" ? "bg-white shadow-sm text-stone-800" : "text-stone-500 hover:text-stone-700"}`} title="Landscape 16:9"><Monitor className="h-3.5 w-3.5" /> 16:9</button>
                        <button onClick={() => setAspectRatio("9:16")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all font-medium ${aspectRatio === "9:16" ? "bg-white shadow-sm text-stone-800" : "text-stone-500 hover:text-stone-700"}`} title="Portrait 9:16"><Smartphone className="h-3.5 w-3.5" /> 9:16</button>
                     </div>

                     <div className={`flex items-center bg-stone-100 p-1 rounded-lg transition-opacity ${model === 'gemini-2.5-flash-image' ? 'opacity-50 pointer-events-none' : ''}`}>
                        {['1K', '2K', '4K'].map((res) => (
                          <button key={res} onClick={() => setResolution(res)} className={`px-3 py-1.5 rounded-md transition-all font-medium ${resolution === res && model !== 'gemini-2.5-flash-image' ? "bg-white shadow-sm text-stone-800" : "text-stone-500 hover:text-stone-700"}`}>{res}</button>
                        ))}
                     </div>

                     <div className="flex items-center bg-stone-100 p-1 rounded-lg">
                       <button onClick={() => setModel("gemini-2.5-flash-image")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all font-medium ${model === "gemini-2.5-flash-image" ? "bg-white shadow-sm text-stone-800" : "text-stone-500 hover:text-stone-700"}`}><Zap className="h-3.5 w-3.5" /> Flash</button>
                       <button onClick={() => setModel("gemini-3-pro-image-preview")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all font-medium ${model === "gemini-3-pro-image-preview" ? "bg-white shadow-sm text-stone-800" : "text-stone-500 hover:text-stone-700"}`}><Sparkles className="h-3.5 w-3.5" /> Pro</button>
                     </div>
                  </div>
                  
                  <button
                    onClick={handleGenerate}
                    disabled={isLoading || isAnimating || !prompt.trim()}
                    className={`w-full xl:w-auto px-8 py-3 rounded-xl font-semibold text-white shadow-lg transition-all flex items-center justify-center gap-2 shrink-0 ${isLoading || isAnimating ? 'bg-stone-300 cursor-not-allowed shadow-none' : 'bg-stone-900 hover:bg-stone-800 hover:shadow-stone-900/20 active:scale-[0.98]'}`}
                  >
                    {isLoading ? <><RefreshCw className="h-5 w-5 animate-spin" /><span>Crafting Scene...</span></> : <><Sparkles className="h-5 w-5" /><span>Generate Image</span></>}
                  </button>
                </div>
              </div>
              {error && (
                <div className="bg-red-50 px-8 py-4 border-t border-red-100 text-red-700 text-sm flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                  <p>{error}</p>
                </div>
              )}
            </section>

            {/* Display Section */}
            <section className="space-y-4">
              <div 
                className={`relative mx-auto bg-stone-100 rounded-3xl overflow-hidden border border-stone-200 shadow-sm flex items-center justify-center transition-all duration-500 ease-in-out
                  ${aspectRatio === '16:9' ? 'w-full aspect-video' : 'w-full max-w-sm aspect-[9/16]'} 
                  ${isLoading || isAnimating ? 'opacity-90' : ''}`}
              >
                 {generatedVideo ? (
                    <div className="relative w-full h-full group">
                      <video 
                        src={generatedVideo} 
                        className="w-full h-full object-cover" 
                        controls
                        autoPlay 
                        loop
                        playsInline
                      />
                      <button 
                         onClick={() => setGeneratedVideo(null)}
                         className="absolute top-4 right-4 bg-black/60 hover:bg-black/80 text-white p-2 rounded-full backdrop-blur-sm transition-all opacity-0 group-hover:opacity-100"
                         title="Close Video"
                      >
                         <X className="h-4 w-4" />
                      </button>
                    </div>
                 ) : generatedImage ? (
                    <img 
                      src={generatedImage} 
                      alt="Generated Scene" 
                      className={`w-full h-full object-cover transition-opacity duration-700 ${isLoading || isAnimating ? 'opacity-50 blur-sm' : 'opacity-100'}`}
                    />
                 ) : (
                   <div className="text-center p-8 max-w-sm mx-auto opacity-40">
                      <ImageIcon className="h-16 w-16 mx-auto mb-4 text-stone-400" />
                      <p className="text-stone-500 font-serif text-lg italic">"The body knows what it's doing."</p>
                      <p className="text-sm text-stone-400 mt-2">Your generated image will appear here.</p>
                   </div>
                 )}

                 {/* Loading Overlays */}
                 {isLoading && (
                   <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/20 backdrop-blur-sm z-10">
                     <div className="h-2 w-48 bg-stone-200 rounded-full overflow-hidden">
                        <div className="h-full bg-stone-800 animate-progress"></div>
                     </div>
                     <p className="mt-4 text-stone-800 font-medium tracking-wide text-sm uppercase">Rendering Light & Texture</p>
                   </div>
                 )}
                 {isAnimating && (
                   <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/20 backdrop-blur-sm z-10">
                     <div className="h-2 w-48 bg-stone-200 rounded-full overflow-hidden">
                        <div className="h-full bg-stone-800 animate-progress"></div>
                     </div>
                     <p className="mt-4 text-stone-800 font-medium tracking-wide text-sm uppercase">Animating Scene...</p>
                   </div>
                 )}
              </div>

              {/* Action Bar */}
              {(generatedImage || generatedVideo) && !isLoading && !isAnimating && (
                <div className="flex flex-wrap justify-end gap-3 items-center">
                  {storageError && <span className="text-xs text-amber-600 flex items-center">{storageError}</span>}
                  
                  {generatedImage && !generatedVideo && (
                    <button
                      onClick={() => setShowVideoPrompt(true)}
                      className="flex items-center gap-2 px-6 py-2.5 bg-white border border-stone-200 hover:border-purple-200 text-stone-700 hover:text-purple-700 rounded-xl shadow-sm hover:bg-purple-50 transition-colors font-medium text-sm group"
                    >
                      <Film className="h-4 w-4 group-hover:scale-110 transition-transform" />
                      Animate Scene
                    </button>
                  )}

                  <button
                    onClick={() => handleSaveToGallery(generatedVideo ? 'video' : 'image')}
                    className="flex items-center gap-2 px-6 py-2.5 bg-white border border-stone-200 hover:border-amber-200 text-stone-700 hover:text-amber-700 rounded-xl shadow-sm hover:bg-amber-50 transition-colors font-medium text-sm group"
                  >
                    <Heart className="h-4 w-4 group-hover:scale-110 transition-transform" />
                    {generatedVideo ? 'Save Video' : 'Save Image'}
                  </button>
                  
                  <button
                    onClick={() => handleDownload(generatedVideo || generatedImage!, undefined, generatedVideo ? 'video' : 'image')}
                    className="flex items-center gap-2 px-6 py-2.5 bg-stone-900 text-white rounded-xl shadow-sm hover:bg-stone-800 transition-colors font-medium text-sm"
                  >
                    <Download className="h-4 w-4" />
                    Download
                  </button>
                </div>
              )}
            </section>
          </div>
        )}

        {/* Gallery View */}
        {activeTab === 'collection' && (
          <div className="animate-in fade-in duration-500 space-y-6">
            <div className="flex items-center justify-between">
               <div>
                  <h2 className="text-2xl font-serif text-stone-900">Your Collection</h2>
                  <p className="text-sm text-stone-500 mt-1">Images and videos saved to your personal gallery</p>
               </div>
               <span className="text-sm text-stone-500 bg-stone-100 px-3 py-1 rounded-full">{savedMedia.length} saved moments</span>
            </div>
            
            {savedMedia.length === 0 ? (
              <div className="bg-white rounded-3xl border border-dashed border-stone-300 p-12 text-center text-stone-400">
                <Grid className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No media saved yet.</p>
                <button 
                  onClick={() => setActiveTab('studio')}
                  className="mt-4 text-stone-900 font-medium underline hover:text-stone-700"
                >
                  Create your first scene
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {savedMedia.map((media) => (
                  <div key={media.id} className="group relative bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow border border-stone-100 flex flex-col">
                    <div className={`relative w-full bg-stone-100 overflow-hidden ${media.aspectRatio === '9:16' ? 'aspect-[3/4]' : 'aspect-video'}`}>
                      {media.type === 'video' ? (
                         <video 
                            src={media.url} 
                            className="w-full h-full object-cover" 
                            controls={true}
                            playsInline
                         />
                      ) : (
                         <img src={media.url} alt="Saved" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                      )}
                      
                      {/* Video Indicator if not playing */}
                      {media.type === 'video' && (
                        <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm text-white p-1.5 rounded-full pointer-events-none">
                           <Film className="h-3 w-3" />
                        </div>
                      )}
                    </div>
                    
                    <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                      <p className="text-xs text-stone-500 line-clamp-2 leading-relaxed" title={media.prompt}>{media.prompt}</p>
                      <div className="flex items-center justify-between pt-2 border-t border-stone-50">
                        <span className="text-[10px] text-stone-400 uppercase tracking-wider flex items-center gap-1">
                          {media.type === 'video' ? 'Video' : 'Image'} • {new Date(media.date).toLocaleDateString()}
                        </span>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => handleDownload(media.url, media.id, media.type)}
                            className="p-2 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-full transition-colors"
                            title="Download"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                          <button 
                            onClick={() => handleDeleteMedia(media.id)}
                            className="p-2 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </main>

      {/* Animation Prompt Modal */}
      {showVideoPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
           <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4">
             <div className="flex items-center justify-between border-b border-stone-100 pb-4">
               <h3 className="text-lg font-serif font-medium text-stone-900 flex items-center gap-2">
                 <Film className="h-5 w-5" />
                 Animate Scene
               </h3>
               <button onClick={() => setShowVideoPrompt(false)} className="text-stone-400 hover:text-stone-600">
                 <X className="h-5 w-5" />
               </button>
             </div>
             
             <div className="space-y-3">
               <p className="text-sm text-stone-500">Describe the movement you want to see (e.g. "Gentle breeze", "Mother smiling"). Leave empty for natural ambient motion.</p>
               <textarea 
                  value={videoPrompt}
                  onChange={(e) => setVideoPrompt(e.target.value)}
                  placeholder="Movimento natural..."
                  className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl text-stone-800 text-sm focus:ring-2 focus:ring-stone-200 outline-none h-24 resize-none"
               />
               
               <div>
                  <label className="text-xs font-semibold text-stone-400 uppercase tracking-wider block mb-2">Quick Presets</label>
                  <div className="flex flex-wrap gap-2">
                    {ANIMATION_PRESETS.map(preset => (
                      <button 
                        key={preset.id}
                        onClick={() => setVideoPrompt(preset.prompt)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 hover:border-stone-300 transition-colors"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
               </div>
             </div>

             <div className="pt-2 flex justify-end gap-3">
                <button 
                  onClick={() => setShowVideoPrompt(false)}
                  className="px-4 py-2 text-stone-500 hover:text-stone-800 text-sm font-medium"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleVideoGeneration}
                  className="px-6 py-2 bg-stone-900 text-white rounded-xl text-sm font-medium hover:bg-stone-800 flex items-center gap-2"
                >
                  <Play className="h-3 w-3 fill-current" />
                  Generate Video
                </button>
             </div>
           </div>
        </div>
      )}

      <style>{`
        @keyframes progress {
          0% { width: 0%; transform: translateX(-100%); }
          50% { width: 50%; }
          100% { width: 100%; transform: translateX(0); }
        }
        .animate-progress {
          animation: progress 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
};

export default App;