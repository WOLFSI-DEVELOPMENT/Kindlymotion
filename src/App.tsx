/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Player } from '@remotion/player';
import { renderMediaOnWeb } from '@remotion/web-renderer';
import { Loader2, Plus, ArrowRight, Image as ImageIcon, Download, ChevronDown, Smartphone, Monitor, Upload, Search, AudioLines, Sparkles, ArrowLeft, X, Wand2 } from 'lucide-react';
import { generateVideoScript, compileVideoComponent, GeneratedVideoConfig, GeminiVideoModel } from './aiService';

interface GeneratedVideo {
  id: string;
  config: GeneratedVideoConfig;
  component: React.FC;
  status: 'preview' | 'rendering' | 'done';
  objectUrl?: string;
  prompt: string;
  contextAssets?: { type: string, url: string }[];
}

interface UploadedAsset {
  id: string;
  type: 'image' | 'audio';
  url: string;
  name: string;
  data?: string; // base64 payload
}

type ModelOption = {
  label: string;
  value: GeminiVideoModel;
};

const MODEL_OPTIONS: ModelOption[] = [
  { label: 'Gemini 2.5 Flash Lite', value: 'gemini-2.5-flash-lite' },
  { label: 'Gemini 3 Flash', value: 'gemini-3-flash-preview' },
  { label: 'Gemini 3 Pro', value: 'gemini-3-pro-preview' },
];

const PixelDotsVisualizer = ({ activeTab }: { activeTab: 'image' | 'audio' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let time = 0;

    const draw = () => {
      time += 0.05;
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const dotSize = 2;
      const spacing = 16;

      ctx.fillStyle = activeTab === 'image' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(200, 200, 255, 0.15)';

      for (let x = 0; x < width; x += spacing) {
        for (let y = 0; y < height; y += spacing) {
          let offsetY = 0;
          let alphaMultiplier = 1;
          
          if (activeTab === 'audio') {
            offsetY = Math.sin(x * 0.05 + time) * 15 * Math.sin(time * 0.5);
            alphaMultiplier = Math.abs(Math.sin(x * 0.05 + time));
          } else {
            // Image active: slow breathing grid pattern
            const dist = Math.sqrt(Math.pow(x - width/2, 2) + Math.pow(y - height/2, 2));
            offsetY = Math.sin(dist * 0.01 - time * 0.5) * 5;
            alphaMultiplier = Math.max(0.2, Math.sin(dist * 0.01 - time * 0.5));
          }

          ctx.beginPath();
          ctx.globalAlpha = alphaMultiplier;
          ctx.arc(x, y + offsetY, dotSize, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      animationFrameId = requestAnimationFrame(draw);
    };

    const resize = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
    };
    window.addEventListener('resize', resize);
    resize();
    draw();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, [activeTab]);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-0" />;
};

export default function App() {
  const PIXAZO_API_KEY = 'cf44410eb6354d058d8a327ddd1ca28e';
  const PIXAZO_IMAGE_ENDPOINT = 'https://gateway.pixazo.ai/getImage/v1/getSDXLImage';
  const PIXAZO_TRACKS_ENDPOINT = 'https://gateway.pixazo.ai/tracks/v1/generate';
  const PIXAZO_STATUS_ENDPOINT = 'https://gateway.pixazo.ai/v2/requests/status';

  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [videos, setVideos] = useState<GeneratedVideo[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [generations, setGenerations] = useState(1);
  const [model, setModel] = useState<ModelOption>(MODEL_OPTIONS[1]);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const optionsRef = useRef<HTMLDivElement>(null);
  const [isAssetPickerOpen, setIsAssetPickerOpen] = useState(false);
  const [activeAssetTab, setActiveAssetTab] = useState<'image' | 'audio'>('image');
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);
  const [sortOption, setSortOption] = useState('Recent');
  const assetPickerRef = useRef<HTMLDivElement>(null);
  const assetPickerPopupRef = useRef<HTMLDivElement>(null);
  const sortDropdownRef = useRef<HTMLDivElement>(null);

  const [uploadedAssets, setUploadedAssets] = useState<UploadedAsset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [selectedContextIds, setSelectedContextIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagePromptInputRef = useRef<HTMLInputElement>(null);
  const audioPromptInputRef = useRef<HTMLInputElement>(null);
  const [isImagePromptOpen, setIsImagePromptOpen] = useState(false);
  const [imagePrompt, setImagePrompt] = useState('');
  const [isImagePromptGenerating, setIsImagePromptGenerating] = useState(false);
  const [isAudioPromptOpen, setIsAudioPromptOpen] = useState(false);
  const [audioPrompt, setAudioPrompt] = useState('');
  const [isAudioPromptGenerating, setIsAudioPromptGenerating] = useState(false);

  const addGeneratedImageAsset = async (imageUrl: string, sourcePrompt: string) => {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to download generated image: ${response.status}`);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read generated image.'));
      reader.readAsDataURL(blob);
    });

    const newAsset: UploadedAsset = {
      id: Math.random().toString(36).substring(7),
      type: 'image',
      url: objectUrl,
      name: `${sourcePrompt.trim().slice(0, 32) || 'Generated image'}.png`,
      data: dataUrl,
    };

    setUploadedAssets(prev => [...prev, newAsset]);
    setActiveAssetTab('image');
  };

  const addGeneratedAudioAsset = async (audioUrl: string, sourcePrompt: string) => {
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(`Failed to download generated audio: ${response.status}`);
    }

    const blob = await response.blob();
    const extension = blob.type.includes('wav') ? 'wav' : blob.type.includes('ogg') ? 'ogg' : 'mp3';
    const objectUrl = URL.createObjectURL(blob);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read generated audio.'));
      reader.readAsDataURL(blob);
    });

    const newAsset: UploadedAsset = {
      id: Math.random().toString(36).substring(7),
      type: 'audio',
      url: objectUrl,
      name: `${sourcePrompt.trim().slice(0, 32) || 'Generated track'}.${extension}`,
      data: dataUrl,
    };

    setUploadedAssets(prev => [...prev, newAsset]);
    setActiveAssetTab('audio');
  };

  const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

  const toggleContextAsset = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSelectedContextIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(aId => aId !== id);
      }
      if (prev.length >= 3) {
        return prev;
      }
      return [...prev, id];
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const url = URL.createObjectURL(file);
      
      const newAsset: UploadedAsset = {
        id: Math.random().toString(36).substring(7),
        type: file.type.startsWith('image/') ? 'image' : 'audio',
        url,
        name: file.name
      };
      
      const reader = new FileReader();
      reader.onloadend = () => {
        newAsset.data = reader.result as string;
        setUploadedAssets(prev => [...prev, newAsset]);
        setActiveAssetTab(newAsset.type);
      };
      reader.readAsDataURL(file);
      
      // Clear input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleImagePromptGenerate = async () => {
    if (activeAssetTab !== 'image' || !imagePrompt.trim() || isImagePromptGenerating) {
      return;
    }

    setIsImagePromptGenerating(true);
    try {
      const response = await fetch(PIXAZO_IMAGE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'Ocp-Apim-Subscription-Key': PIXAZO_API_KEY,
        },
        body: JSON.stringify({
          prompt: imagePrompt.trim(),
          negative_prompt: 'Low-quality, blurry image, abstract or cartoonish styles, dark or gloomy atmosphere, unnecessary objects or distractions, harsh lighting, unnatural colors.',
          height: 1024,
          width: 1024,
          num_steps: 20,
          guidance_scale: 5,
          seed: 40,
        }),
      });

      if (!response.ok) {
        throw new Error(`Pixazo request failed: ${response.status}`);
      }

      const data = await response.json() as { imageUrl?: string };
      if (!data.imageUrl) {
        throw new Error('Pixazo returned no image URL.');
      }

      await addGeneratedImageAsset(data.imageUrl, imagePrompt);
      setImagePrompt('');
      setIsImagePromptOpen(false);
    } catch (error) {
      console.error(error);
      alert('Failed to generate image. Check console for details.');
    } finally {
      setIsImagePromptGenerating(false);
    }
  };

  const handleAudioPromptGenerate = async () => {
    if (activeAssetTab !== 'audio' || !audioPrompt.trim() || isAudioPromptGenerating) {
      return;
    }

    setIsAudioPromptGenerating(true);
    try {
      const generateResponse = await fetch(PIXAZO_TRACKS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'Ocp-Apim-Subscription-Key': PIXAZO_API_KEY,
        },
        body: JSON.stringify({
          prompt: audioPrompt.trim(),
          lyrics: '',
          instrumental: true,
          duration: 45,
          bpm: 120,
          infer_steps: 25,
          guidance_scale: 7.5,
          seed: 42,
        }),
      });

      if (!generateResponse.ok) {
        throw new Error(`Pixazo tracks request failed: ${generateResponse.status}`);
      }

      const queued = await generateResponse.json() as { request_id?: string };
      if (!queued.request_id) {
        throw new Error('Pixazo returned no request id for audio generation.');
      }

      let mediaUrl: string | null = null;
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await wait(5000);
        const statusResponse = await fetch(`${PIXAZO_STATUS_ENDPOINT}/${queued.request_id}`, {
          headers: {
            'Ocp-Apim-Subscription-Key': PIXAZO_API_KEY,
          },
        });

        if (!statusResponse.ok) {
          throw new Error(`Pixazo status request failed: ${statusResponse.status}`);
        }

        const statusData = await statusResponse.json() as {
          status?: string;
          error?: string | null;
          output?: { media_url?: string[] };
        };

        if (statusData.status === 'COMPLETED' && statusData.output?.media_url?.[0]) {
          mediaUrl = statusData.output.media_url[0];
          break;
        }

        if (statusData.status === 'FAILED' || statusData.status === 'ERROR') {
          throw new Error(statusData.error || 'Audio generation failed.');
        }
      }

      if (!mediaUrl) {
        throw new Error('Audio generation timed out before completion.');
      }

      await addGeneratedAudioAsset(mediaUrl, audioPrompt);
      setAudioPrompt('');
      setIsAudioPromptOpen(false);
    } catch (error) {
      console.error(error);
      alert('Failed to generate music. Check console for details.');
    } finally {
      setIsAudioPromptGenerating(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (optionsRef.current && !optionsRef.current.contains(event.target as Node)) {
        setIsOptionsOpen(false);
        setIsModelDropdownOpen(false);
      }
      if (assetPickerRef.current && !assetPickerRef.current.contains(event.target as Node) && !(assetPickerPopupRef.current && assetPickerPopupRef.current.contains(event.target as Node))) {
        setIsAssetPickerOpen(false);
        setIsSortDropdownOpen(false); // Close nested dropdown if closed main picker
      }
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(event.target as Node)) {
        setIsSortDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (activeAssetTab === 'image') {
      setIsAudioPromptOpen(false);
      setAudioPrompt('');
    } else {
      setIsImagePromptOpen(false);
      setImagePrompt('');
    }

    if (isImagePromptOpen) {
      window.setTimeout(() => imagePromptInputRef.current?.focus(), 0);
    }
    if (isAudioPromptOpen) {
      window.setTimeout(() => audioPromptInputRef.current?.focus(), 0);
    }
  }, [activeAssetTab, isAudioPromptOpen, isImagePromptOpen]);

  useEffect(() => {
    const loadVideos = async () => {
      const saved = localStorage.getItem('minecraft-videos-v1');
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as { id: string; config: GeneratedVideoConfig; prompt: string }[];
          
          const loadedVideos: GeneratedVideo[] = [];
          // Load in reverse order to show newest if they were saved that way, or just load as is.
          for (const item of parsed) {
            try {
              const component = await compileVideoComponent(item.config.code);
              loadedVideos.push({
                id: item.id,
                config: item.config,
                component,
                status: 'preview',
                prompt: item.prompt,
              });
            } catch (err) {
              console.error(`Failed to load component for video ${item.id}`, err);
            }
          }
          setVideos(loadedVideos);
        } catch (err) {
          console.error('Local storage parsing error:', err);
        }
      }
      setIsLoaded(true);
    };
    loadVideos();
  }, []);

  useEffect(() => {
    if (isLoaded) {
      const toSave = videos.map((v) => ({ id: v.id, config: v.config, prompt: v.prompt }));
      localStorage.setItem('minecraft-videos-v1', JSON.stringify(toSave));
    }
  }, [videos, isLoaded]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!prompt.trim() && selectedContextIds.length === 0) || isGenerating) return;

    setIsGenerating(true);
    try {
      const contextAssets = uploadedAssets
        .filter(a => selectedContextIds.includes(a.id) && a.data)
        .map(a => ({ type: a.type, data: a.data! }));

      const config = await generateVideoScript(prompt, contextAssets, model.value);
      
      let videoContextAssets = uploadedAssets
        .filter(a => selectedContextIds.includes(a.id))
        .map(a => ({ type: a.type, url: a.url }));

      if (config.ttsAudioBase64) {
        const newAssetId = "tts_" + Math.random().toString(36).substring(7);
        const dataUrl = `data:audio/wav;base64,${config.ttsAudioBase64}`;
        
        const newAsset: UploadedAsset = {
          id: newAssetId,
          type: 'audio',
          name: 'AI Voiceover.wav',
          url: dataUrl,
          data: config.ttsAudioBase64
        };
        
        setUploadedAssets(prev => [...prev, newAsset]);
        // Also auto-select it? Maybe optional, but we need it for this video!
        // We append it to the context assets passed to the generated component
        videoContextAssets.push({ type: 'audio', url: dataUrl });
      }

      const compiledComponent = await compileVideoComponent(config.code);

      const newVideo: GeneratedVideo = {
        id: Math.random().toString(36).substring(7),
        config,
        component: compiledComponent,
        status: 'preview',
        prompt,
        contextAssets: videoContextAssets,
      };

      setVideos((prev) => [newVideo, ...prev]);
      setPrompt('');
      setSelectedContextIds([]);
    } catch (error) {
      console.error(error);
      alert('Failed to generate script. Check console for details.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = async (video: GeneratedVideo) => {
    setVideos((prev) => prev.map((v) => v.id === video.id ? { ...v, status: 'rendering' } : v));
    
    try {
      const result = await renderMediaOnWeb({
        composition: {
          id: video.id,
          component: video.component,
          durationInFrames: Math.max(video.config.durationInFrames, 1),
          fps: video.config.fps || 30,
          width: video.config.width || 1280,
          height: video.config.height || 720,
        },
        inputProps: {},
        container: 'webm',
        videoCodec: 'vp8',
        videoBitrate: 1000000,
      });

      const blob = await result.getBlob();
      const url = URL.createObjectURL(blob);
      
      setVideos((prev) => prev.map((v) => v.id === video.id ? { ...v, status: 'done', objectUrl: url } : v));

      const a = document.createElement('a');
      a.href = url;
      a.download = `video-${video.id}.webm`;
      a.click();
    } catch (err) {
      console.error('Render failed', err);
      alert('Render failed. See console.');
      setVideos((prev) => prev.map((v) => v.id === video.id ? { ...v, status: 'preview' } : v));
    }
  };

  const renderGeneratingBox = (isVertical: boolean = false) => (
    <div className={`relative group super-pill-medium overflow-hidden ${isVertical ? 'aspect-[9/16] w-[260px] shrink-0 max-w-[80vw] snap-center flex-none' : 'aspect-video w-full'} border border-white/5 bg-[#1A1A1C] break-inside-avoid`}>
      <div className="absolute inset-0 animate-smoke z-0 opacity-80" />
      <PixelDotsVisualizer activeTab="image" />
      <div className="absolute inset-0 flex flex-col items-center justify-center z-10 gap-3 backdrop-blur-[2px]">
         <Loader2 className="w-8 h-8 text-white/40 animate-spin" />
         <span className="text-white/40 text-sm font-medium tracking-wide">Crafting video...</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 pointer-events-none p-5 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex items-end justify-between z-10">
        <div className="flex items-center gap-2 text-white/50">
          <ImageIcon className="w-[18px] h-[18px]" strokeWidth={1.5} />
          <p className="text-[15px] font-medium leading-none drop-shadow-md truncate max-w-[80%]">{prompt || "Generating..."}</p>
        </div>
      </div>
    </div>
  );

  const renderVideoBox = (vid: GeneratedVideo, isVertical: boolean = false) => (
    <div key={vid.id} className={`relative group super-pill-medium overflow-hidden bg-[#111] ${isVertical ? 'aspect-[9/16] w-[260px] shrink-0 max-w-[80vw] snap-center flex-none' : 'aspect-video w-full'} border border-white/5 break-inside-avoid`}>
      <div className="absolute inset-0 z-0">
        <Player
          component={vid.component}
          inputProps={{ contextAssets: vid.contextAssets || [] }}
          durationInFrames={vid.config.durationInFrames || 60}
          compositionWidth={vid.config.width || 1280}
          compositionHeight={vid.config.height || 720}
          fps={vid.config.fps || 30}
          controls={true}
          loop
          style={{ width: '100%', height: '100%' }}
        />
      </div>
      
      {vid.status === 'rendering' && (
        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-white backdrop-blur-sm z-20">
          <Loader2 className="w-12 h-12 animate-spin mb-4 text-white" />
          <span className="text-sm font-medium">Rendering...</span>
        </div>
      )}

      {/* Title overlay at the bottom matching reference */}
      <div className="absolute inset-x-0 bottom-0 pointer-events-none p-5 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex items-end justify-between z-10">
        <div className="flex items-center gap-2 text-white/90">
          <ImageIcon className="w-[18px] h-[18px]" strokeWidth={1.5} />
          <p className="text-[15px] font-medium leading-none drop-shadow-md truncate max-w-[80%]">{vid.prompt}</p>
        </div>
        
        <div className="pointer-events-auto">
          {vid.status === 'done' && vid.objectUrl ? (
            <button 
              onClick={() => {
                const a = document.createElement('a');
                a.href = vid.objectUrl!;
                a.download = `video-${vid.id}.webm`;
                a.click();
              }}
              className="p-2 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-md transition-colors"
              title="Download Video"
            >
              <Download className="w-5 h-5" />
            </button>
          ) : (
            <button 
              onClick={() => handleDownload(vid)}
              disabled={vid.status === 'rendering'}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md transition-colors disabled:opacity-50"
              title="Render to WebM"
            >
              {vid.status === 'rendering' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-black text-white relative font-sans overflow-hidden flex flex-col">
      {/* Background Videos Grid */}
      <div className="absolute inset-0 p-6 pt-10 pb-32 overflow-y-auto w-full">
        <div className="flex flex-col gap-12 w-full max-w-[1600px] mx-auto overflow-hidden px-4">
          {/* Horizontal (16:9) Group */}
          {(videos.some(vid => vid.config.width >= vid.config.height) || (isGenerating && aspectRatio === '16:9')) && (
            <div>
              <h2 className="text-xl font-bold text-white mb-6 px-2 flex items-center gap-2">
                <Monitor className="w-5 h-5 text-gray-400" />
                <span>Horizontal Videos</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
                {isGenerating && aspectRatio === '16:9' && renderGeneratingBox(false)}
                {videos.filter(vid => vid.config.width >= vid.config.height).map(vid => renderVideoBox(vid, false))}
              </div>
            </div>
          )}

          {/* Vertical (9:16) Group */}
          {(videos.some(vid => vid.config.height > vid.config.width) || (isGenerating && aspectRatio === '9:16')) && (
            <div className="w-full relative overflow-hidden">
              <h2 className="text-xl font-bold text-white mb-6 px-2 flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-gray-400" />
                <span>Vertical Videos</span>
              </h2>
              <div className="flex flex-row overflow-x-auto gap-6 w-full pb-6 snap-x scrollbar-thin">
                {isGenerating && aspectRatio === '9:16' && renderGeneratingBox(true)}
                {videos.filter(vid => vid.config.height > vid.config.width).map(vid => renderVideoBox(vid, true))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Floating Input Area */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4 z-50 flex flex-col gap-3">
        {selectedContextIds.length > 0 && (
          <div className="flex gap-3 px-4 items-end">
            {uploadedAssets.filter(a => selectedContextIds.includes(a.id)).map(asset => (
              <div key={asset.id} className="relative w-16 h-16 shrink-0 group">
                <div className="w-full h-full rounded-2xl overflow-hidden border border-white/10 bg-[#1A1A1C] shadow-lg">
                  {asset.type === 'image' ? (
                    <img src={asset.url} className="w-full h-full object-cover" alt="" />
                  ) : (
                    <div className="w-full h-full bg-[#111] flex items-center justify-center">
                      <AudioLines size={20} className="text-white/50" />
                    </div>
                  )}
                </div>
                <button 
                  type="button"
                  onClick={(e) => toggleContextAsset(e, asset.id)}
                  className="absolute -top-2 -right-2 bg-[#2A2A2A] border border-white/10 w-6 h-6 flex items-center justify-center rounded-full text-white shadow-xl opacity-0 group-hover:opacity-100 transition-all transform hover:scale-105 z-10"
                >
                   <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="relative">
          {isGenerating && (
            <div className="input-glow-track z-0" aria-hidden="true">
              <div className="input-glow-wave" />
            </div>
          )}
          <form 
            onSubmit={handleGenerate}
            className="flex flex-col justify-center bg-[#18181A] p-2 pl-4 border border-white/5 shadow-2xl relative transition-all super-pill-medium z-10"
            style={{ 
              minHeight: '90px'
            }}
          >
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isGenerating}
            placeholder={selectedContextIds.length > 0 ? "What do you want to create with these assets?" : "What do you want to create?"}
            className="w-full bg-transparent text-white placeholder-gray-500/80 text-[15px] focus:outline-none min-w-0 pt-3 pb-8 px-1"
          />
          
          <div className="flex items-end justify-between absolute bottom-1.5 left-4 right-[5px]">
            <div className="relative" ref={assetPickerRef}>
              <button 
                type="button" 
                onClick={() => setIsAssetPickerOpen(!isAssetPickerOpen)}
                className="text-gray-400 hover:text-white transition-colors h-8 flex items-center mb-0.5 relative z-10"
              >
                <Plus size={22} strokeWidth={2} />
              </button>

              {isAssetPickerOpen && createPortal(
                <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none">
                  <div ref={assetPickerPopupRef} className="pointer-events-auto w-[800px] h-[500px] max-w-[calc(100vw-32px)] bg-[#1A1A1C] border border-[#2A2A2A] rounded-[24px] p-4 flex flex-col shadow-2xl">
                    <div className="flex items-center gap-3">
                      <div className="flex bg-[#2A2A2A]/50 rounded-[14px] p-1 h-[40px]">
                      <button 
                        type="button"
                        onClick={() => setActiveAssetTab('image')}
                        className={`flex items-center gap-2 px-4 h-full rounded-[10px] text-[14px] font-medium transition-all ${activeAssetTab === 'image' ? 'bg-[#404040] text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}
                      >
                         <ImageIcon size={16} /> Image
                      </button>
                      <button 
                        type="button"
                        onClick={() => setActiveAssetTab('audio')}
                        className={`flex items-center gap-2 px-4 h-full rounded-[10px] text-[14px] font-medium transition-all ${activeAssetTab === 'audio' ? 'bg-[#404040] text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}
                      >
                         <AudioLines size={16} /> Audio
                      </button>
                    </div>
                    
                    <div className="flex-1 relative h-[40px]">
                      <input 
                        type="text" 
                        placeholder="Search for Assets" 
                        className="w-full h-full bg-white/5 hover:bg-white/10 rounded-[14px] px-4 text-[14px] text-white placeholder-gray-500 focus:outline-none focus:bg-[#2A2A2A] transition-colors pl-10" 
                      />
                      <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
                    </div>

                    <div className="relative" ref={sortDropdownRef}>
                      <button 
                        type="button" 
                        onClick={() => setIsSortDropdownOpen(!isSortDropdownOpen)}
                        className={`flex items-center gap-1.5 px-4 h-[40px] hover:bg-white/10 text-[14px] font-medium rounded-[14px] text-gray-300 whitespace-nowrap transition-colors ${isSortDropdownOpen ? 'bg-white/10' : 'bg-white/5'}`}
                      >
                        {sortOption} <ChevronDown size={16} className="opacity-70" />
                      </button>

                      {isSortDropdownOpen && (
                        <div className="absolute top-[calc(100%+8px)] right-0 w-[160px] bg-[#181818] border border-[#2A2A2A] rounded-[22px] p-2 flex flex-col shadow-2xl z-50">
                          {['Recent', 'Most Used', 'Newest', 'Oldest', 'Favorites'].map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => { setSortOption(opt); setIsSortDropdownOpen(false); }}
                              className={`text-left px-4 py-3 rounded-[16px] text-[15px] font-bold transition-colors ${sortOption === opt ? 'bg-[#333] text-white' : 'text-gray-300 hover:bg-[#202020] hover:text-white'}`}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex gap-4 flex-1 mt-4 relative rounded-[20px] overflow-hidden">
                    <PixelDotsVisualizer activeTab={activeAssetTab} />
                    
                    {uploadedAssets.filter(a => a.type === activeAssetTab).length === 0 ? (
                       <div className="absolute inset-0 z-20 pointer-events-none">
                           <input type="file" ref={fileInputRef} className="hidden" accept={activeAssetTab === 'image' ? 'image/*' : 'audio/*'} onChange={handleFileUpload} />
                           {(activeAssetTab === 'image' && isImagePromptOpen) || (activeAssetTab === 'audio' && isAudioPromptOpen) ? (
                             <form
                               className="pointer-events-auto absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-[3px]"
                               onSubmit={(e) => {
                                 e.preventDefault();
                                 if (activeAssetTab === 'image') {
                                   void handleImagePromptGenerate();
                                 } else {
                                   void handleAudioPromptGenerate();
                                 }
                               }}
                             >
                               <input
                                 ref={activeAssetTab === 'image' ? imagePromptInputRef : audioPromptInputRef}
                                 type="text"
                                 value={activeAssetTab === 'image' ? imagePrompt : audioPrompt}
                                 onChange={(e) => {
                                   if (activeAssetTab === 'image') {
                                     setImagePrompt(e.target.value);
                                   } else {
                                     setAudioPrompt(e.target.value);
                                   }
                                 }}
                                 placeholder={activeAssetTab === 'image' ? 'Generate an image...' : 'Generate music...'}
                                 className="h-[50px] w-[320px] max-w-[calc(100vw-112px)] rounded-full bg-white px-5 text-[14px] font-medium text-black placeholder:text-black/45 focus:outline-none"
                                 disabled={activeAssetTab === 'image' ? isImagePromptGenerating : isAudioPromptGenerating}
                               />
                               <button
                                 type="submit"
                                 aria-label={activeAssetTab === 'image' ? 'Generate image' : 'Generate music'}
                                 disabled={activeAssetTab === 'image' ? (!imagePrompt.trim() || isImagePromptGenerating) : (!audioPrompt.trim() || isAudioPromptGenerating)}
                                 className="h-[50px] w-[60px] bg-white text-black flex items-center justify-center rounded-full transition-colors hover:bg-[#f3f3f3] disabled:opacity-50"
                               >
                                 {(activeAssetTab === 'image' ? isImagePromptGenerating : isAudioPromptGenerating) ? (
                                   <Loader2 size={18} className="animate-spin" />
                                 ) : (
                                   <Wand2 size={18} strokeWidth={2.1} />
                                 )}
                               </button>
                             </form>
                           ) : (
                             <div className="pointer-events-auto absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-[3px]">
                                <button
                                  type="button"
                                  onClick={() => fileInputRef.current?.click()}
                                  className="h-[50px] px-6 bg-white text-black flex items-center gap-2 rounded-l-full rounded-r-[14px] transition-colors hover:bg-[#f3f3f3] active:bg-[#e9e9e9] cursor-pointer"
                                >
                                  <Upload size={18} strokeWidth={2.2} />
                                  <span className="font-semibold text-[15px]">Upload</span>
                                </button>
                                <button
                                  type="button"
                                  aria-label="Generate"
                                  onClick={() => {
                                    if (activeAssetTab === 'image') {
                                      setIsImagePromptOpen(true);
                                      setIsAudioPromptOpen(false);
                                    } else {
                                      setIsAudioPromptOpen(true);
                                      setIsImagePromptOpen(false);
                                    }
                                  }}
                                  className="h-[50px] w-[60px] bg-white text-black flex items-center justify-center rounded-l-[14px] rounded-r-full transition-colors hover:bg-[#f3f3f3] cursor-pointer"
                                >
                                  <Wand2 size={18} strokeWidth={2.1} />
                                </button>
                             </div>
                           )}
                       </div>
                    ) : (
                       <div className="w-full h-full relative z-10 bg-[#111]/80 backdrop-blur-md rounded-[16px] overflow-hidden border border-white/5 shadow-xl p-4">
                          <input type="file" ref={fileInputRef} className="hidden" accept={activeAssetTab === 'image' ? 'image/*' : 'audio/*'} onChange={handleFileUpload} />
                          {!selectedAssetId ? (
                              <div className="w-full h-full overflow-y-auto scrollbar-thin">
                                 <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 auto-rows-[160px]">
                                     {uploadedAssets.filter(a => a.type === activeAssetTab).map(asset => {
                                        const isSelected = selectedContextIds.includes(asset.id);
                                        return (
                                        <div 
                                          key={asset.id} 
                                          onClick={() => setSelectedAssetId(asset.id)}
                                          className={`bg-black/50 rounded-[14px] overflow-hidden cursor-pointer flex flex-col border transition-all group relative ${isSelected ? 'border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.3)]' : 'border-white/10 hover:border-white/50 hover:shadow-[0_0_20px_rgba(255,255,255,0.1)]'}`}
                                        >
                                            <button
                                              type="button"
                                              onClick={(e) => toggleContextAsset(e, asset.id)}
                                              className={`absolute top-2 right-2 z-20 w-8 h-8 rounded-full flex items-center justify-center transition-all ${isSelected ? 'bg-blue-500 text-white' : 'bg-black/50 text-white/50 hover:bg-black/80 hover:text-white backdrop-blur-md'}`}
                                            >
                                               {isSelected ? <Sparkles size={14} /> : <Plus size={18} />}
                                            </button>
                                            <div className="flex-1 w-full overflow-hidden bg-black flex items-center justify-center">
                                                {asset.type === 'image' ? (
                                                    <img src={asset.url} className={`w-full h-full object-cover transition-transform duration-500 ${isSelected ? 'scale-105' : 'group-hover:scale-110'}`} />
                                                ) : (
                                                    <AudioLines size={32} className={`transition-colors ${isSelected ? 'text-blue-400' : 'text-white/50 group-hover:text-white'}`} />
                                                )}
                                            </div>
                                            <div className="p-3 bg-[#1A1A1C] border-t border-white/5 truncate text-[13px] font-medium text-gray-300">
                                                {asset.name.replace(/\.[^/.]+$/, "")}
                                            </div>
                                        </div>
                                     )})}
                                     <div 
                                       onClick={() => fileInputRef.current?.click()}
                                       className="bg-white/5 rounded-[14px] border border-white/10 border-dashed flex flex-col items-center justify-center cursor-pointer hover:bg-white/10 transition-colors text-white/50 hover:text-white group"
                                     >
                                        <Upload size={28} strokeWidth={1.5} className="mb-2 group-hover:-translate-y-1 transition-transform" />
                                        <span className="text-[14px] font-medium">Upload More</span>
                                     </div>
                                 </div>
                              </div>
                          ) : (
                              <div className="w-full h-full relative flex flex-col bg-black rounded-xl overflow-hidden border border-white/10 group">
                                 <div className="absolute top-4 left-4 z-20">
                                     <button 
                                        onClick={() => setSelectedAssetId(null)}
                                        className="bg-black/50 hover:bg-black/80 backdrop-blur-md border border-white/20 w-10 h-10 flex items-center justify-center rounded-full text-white transition-all hover:scale-105 shadow-xl"
                                     >
                                         <ArrowLeft size={20} />
                                     </button>
                                 </div>
                                 <div className="absolute top-4 right-4 z-20">
                                     <button 
                                        onClick={(e) => toggleContextAsset(e, selectedAssetId!)}
                                        className={`px-4 h-10 flex items-center gap-2 rounded-full font-medium transition-all shadow-xl ${selectedContextIds.includes(selectedAssetId!) ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-black/50 hover:bg-black/80 text-white border border-white/20 backdrop-blur-md hover:scale-105'}`}
                                     >
                                         {selectedContextIds.includes(selectedAssetId!) ? (
                                           <><Sparkles size={16} /> Added to Context</>
                                         ) : (
                                           <><Plus size={16} /> Add to Context</>
                                         )}
                                     </button>
                                 </div>
                                 <div className="flex-1 flex items-center justify-center">
                                    {uploadedAssets.find(a => a.id === selectedAssetId)?.type === 'image' ? (
                                        <img src={uploadedAssets.find(a => a.id === selectedAssetId)?.url} className="w-full h-full object-contain" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center bg-[#111]">
                                            <audio src={uploadedAssets.find(a => a.id === selectedAssetId)?.url} controls className="w-3/4 outline-none" />
                                        </div>
                                    )}
                                 </div>
                              </div>
                          )}
                       </div>
                    )}
                  </div>
                </div>
                </div>, document.body
              )}
            </div>
            <div className="flex items-end gap-2">
              <div className="hidden sm:flex relative mb-[3px]" ref={optionsRef}>
                <button
                  type="button"
                  onClick={() => setIsOptionsOpen(!isOptionsOpen)}
                  className="flex items-center gap-1.5 px-3 h-8 rounded-full border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <span className="text-xs font-medium">Video</span>
                  <span className="text-gray-400 text-[10px] bg-white/5 border border-white/10 rounded px-1 py-0.5">x{generations}</span>
                </button>

                {isOptionsOpen && (
                  <div className="absolute bottom-[44px] left-1/2 -translate-x-1/2 sm:translate-x-0 sm:left-auto sm:right-0 w-[310px] bg-[#141414] border border-[#2A2A2A] rounded-[24px] p-2.5 flex flex-col gap-2 shadow-2xl z-50">
                    <div className="flex gap-2 h-[64px]">
                      <button
                        type="button"
                        onClick={() => setAspectRatio('9:16')}
                        className={`flex-1 flex flex-col items-center justify-center rounded-[18px] text-[15px] font-bold transition-all ${aspectRatio === '9:16' ? 'bg-[#404040] text-white shadow-sm' : 'bg-[#202020] text-[#c0c0c0] hover:bg-[#2A2A2A] hover:text-white'}`}
                      >
                        <div className="w-[10px] h-[16px] rounded-[2px] flex-shrink-0 border-[2px] border-current mb-[5px] mt-1" />
                        9:16
                      </button>
                      <button
                        type="button"
                        onClick={() => setAspectRatio('16:9')}
                        className={`flex-1 flex flex-col items-center justify-center rounded-[18px] text-[15px] font-bold transition-all ${aspectRatio === '16:9' ? 'bg-[#404040] text-white shadow-sm' : 'bg-[#202020] text-[#c0c0c0] hover:bg-[#2A2A2A] hover:text-white'}`}
                      >
                        <div className="w-[18px] h-[10px] rounded-[2px] flex-shrink-0 border-[2px] border-current mb-[7px] mt-[5px]" />
                        16:9
                      </button>
                    </div>

                    <div className="flex bg-[#202020] rounded-[18px] p-[4px] h-[52px] items-center">
                      {[1, 2, 3, 4].map(num => (
                        <button
                          key={num}
                          type="button"
                          onClick={() => setGenerations(num)}
                          className={`flex-1 h-full rounded-[14px] text-[15px] font-bold transition-all ${generations === num ? 'bg-[#404040] text-white shadow-sm' : 'text-[#c0c0c0] hover:bg-[#2A2A2A] hover:text-white'}`}
                        >
                          x{num}
                        </button>
                      ))}
                    </div>

                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                        className={`w-full bg-[#202020] hover:bg-[#2A2A2A] text-white font-bold rounded-[18px] h-[52px] px-5 text-[15px] flex items-center justify-between transition-colors ${isModelDropdownOpen ? 'bg-[#2A2A2A]' : ''}`}
                      >
                        {model.label}
                        <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[6px] border-t-white ml-2 opacity-80" />
                      </button>

                      {isModelDropdownOpen && (
                        <div className="absolute bottom-[calc(100%+8px)] left-0 w-full bg-[#181818] border border-[#2A2A2A] rounded-[22px] p-2 flex flex-col shadow-2xl z-50 overflow-hidden">
                          {MODEL_OPTIONS.map((m) => (
                            <button
                              key={m.value}
                              type="button"
                              onClick={() => { setModel(m); setIsModelDropdownOpen(false); }}
                              className={`text-left px-5 py-4 rounded-[16px] text-[15px] font-bold transition-colors ${model.value === m.value ? 'bg-[#333] text-white' : 'text-gray-300 hover:bg-[#202020] hover:text-white'}`}
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              
              <button 
                type="submit" 
                disabled={isGenerating || !prompt.trim()}
                className="bg-white text-black h-[34px] w-[34px] rounded-full hover:bg-gray-200 transition-colors disabled:opacity-50 flex items-center justify-center shadow-md active:scale-95"
              >
                {isGenerating ? (
                  <Loader2 className="w-4 h-4 animate-spin text-black" />
                ) : (
                  <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
                )}
              </button>
            </div>
          </div>
          </form>
        </div>
      </div>
    </div>
  );
}
