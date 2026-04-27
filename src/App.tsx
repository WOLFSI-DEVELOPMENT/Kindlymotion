import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Player } from '@remotion/player';
import { renderMediaOnWeb } from '@remotion/web-renderer';
import { ArrowLeft, ArrowRight, AudioLines, ChevronDown, Download, Image as ImageIcon, Loader2, Monitor, Plus, Search, Smartphone, Sparkles, Upload, Wand2, X } from 'lucide-react';
import { compileVideoComponent, generateVideoScript, GeneratedVideoConfig } from './aiService';

interface GeneratedVideo {
  id: string;
  config: GeneratedVideoConfig;
  component: React.FC;
  status: 'preview' | 'rendering' | 'done';
  prompt: string;
  objectUrl?: string;
  contextAssets?: { type: string; url: string }[];
}

interface UploadedAsset {
  id: string;
  type: 'image' | 'audio';
  url: string;
  name: string;
  data?: string;
}

const PIXAZO_API_KEY = 'cf44410eb6354d058d8a327ddd1ca28e';
const PIXAZO_IMAGE_ENDPOINT = 'https://gateway.pixazo.ai/getImage/v1/getSDXLImage';
const PIXAZO_TRACKS_ENDPOINT = 'https://gateway.pixazo.ai/tracks/v1/generate';
const PIXAZO_STATUS_ENDPOINT = 'https://gateway.pixazo.ai/v2/requests/status';

const PixelDotsVisualizer = ({ activeTab }: { activeTab: 'image' | 'audio' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frameId = 0;
    let time = 0;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    };

    const draw = () => {
      time += 0.05;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = activeTab === 'image' ? 'rgba(255,255,255,0.15)' : 'rgba(200,200,255,0.15)';

      for (let x = 0; x < canvas.width; x += 16) {
        for (let y = 0; y < canvas.height; y += 16) {
          const offset = activeTab === 'audio'
            ? Math.sin(x * 0.05 + time) * 15 * Math.sin(time * 0.5)
            : Math.sin(Math.hypot(x - canvas.width / 2, y - canvas.height / 2) * 0.01 - time * 0.5) * 5;
          ctx.beginPath();
          ctx.arc(x, y + offset, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      frameId = requestAnimationFrame(draw);
    };

    window.addEventListener('resize', resize);
    resize();
    draw();
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(frameId);
    };
  }, [activeTab]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full pointer-events-none z-0" />;
};

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [videos, setVideos] = useState<GeneratedVideo[]>([]);
  const [uploadedAssets, setUploadedAssets] = useState<UploadedAsset[]>([]);
  const [selectedContextIds, setSelectedContextIds] = useState<string[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [isAssetPickerOpen, setIsAssetPickerOpen] = useState(false);
  const [activeAssetTab, setActiveAssetTab] = useState<'image' | 'audio'>('image');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');
  const [isImagePromptOpen, setIsImagePromptOpen] = useState(false);
  const [isAudioPromptOpen, setIsAudioPromptOpen] = useState(false);
  const [imagePrompt, setImagePrompt] = useState('');
  const [audioPrompt, setAudioPrompt] = useState('');
  const [isImagePromptGenerating, setIsImagePromptGenerating] = useState(false);
  const [isAudioPromptGenerating, setIsAudioPromptGenerating] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const assetPickerRef = useRef<HTMLDivElement>(null);
  const assetPickerPopupRef = useRef<HTMLDivElement>(null);
  const imagePromptInputRef = useRef<HTMLInputElement>(null);
  const audioPromptInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (assetPickerRef.current && !assetPickerRef.current.contains(event.target as Node) && !(assetPickerPopupRef.current?.contains(event.target as Node))) {
        setIsAssetPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (activeAssetTab === 'image') {
      setIsAudioPromptOpen(false);
      setAudioPrompt('');
      if (isImagePromptOpen) window.setTimeout(() => imagePromptInputRef.current?.focus(), 0);
    } else {
      setIsImagePromptOpen(false);
      setImagePrompt('');
      if (isAudioPromptOpen) window.setTimeout(() => audioPromptInputRef.current?.focus(), 0);
    }
  }, [activeAssetTab, isAudioPromptOpen, isImagePromptOpen]);

  const selectedAssets = useMemo(
    () => uploadedAssets.filter((asset) => selectedContextIds.includes(asset.id)),
    [uploadedAssets, selectedContextIds],
  );

  const toggleContextAsset = (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    setSelectedContextIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current.slice(0, 2), id]);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const asset: UploadedAsset = {
      id: Math.random().toString(36).slice(2),
      type: file.type.startsWith('image/') ? 'image' : 'audio',
      name: file.name,
      url: URL.createObjectURL(file),
    };

    const reader = new FileReader();
    reader.onloadend = () => {
      asset.data = reader.result as string;
      setUploadedAssets((current) => [...current, asset]);
      setActiveAssetTab(asset.type);
    };
    reader.readAsDataURL(file);

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const addRemoteAsset = async (url: string, type: 'image' | 'audio', sourcePrompt: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to download generated asset: ${response.status}`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read generated asset.'));
      reader.readAsDataURL(blob);
    });

    const extension = type === 'image'
      ? 'png'
      : blob.type.includes('wav') ? 'wav' : blob.type.includes('ogg') ? 'ogg' : 'mp3';

    setUploadedAssets((current) => [
      ...current,
      {
        id: Math.random().toString(36).slice(2),
        type,
        url: objectUrl,
        data: dataUrl,
        name: `${sourcePrompt.trim().slice(0, 32) || (type === 'image' ? 'Generated image' : 'Generated track')}.${extension}`,
      },
    ]);
    setActiveAssetTab(type);
  };

  const handleImagePromptGenerate = async () => {
    if (!imagePrompt.trim() || isImagePromptGenerating) return;
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
          negative_prompt: 'Low-quality, blurry image, abstract or cartoonish styles, dark atmosphere, harsh lighting, unnatural colors.',
          height: 1024,
          width: 1024,
          num_steps: 20,
          guidance_scale: 5,
          seed: 40,
        }),
      });
      if (!response.ok) throw new Error(`Pixazo image request failed: ${response.status}`);
      const data = await response.json() as { imageUrl?: string };
      if (!data.imageUrl) throw new Error('Pixazo returned no image URL.');
      await addRemoteAsset(data.imageUrl, 'image', imagePrompt);
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
    if (!audioPrompt.trim() || isAudioPromptGenerating) return;
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
      if (!generateResponse.ok) throw new Error(`Pixazo music request failed: ${generateResponse.status}`);
      const queued = await generateResponse.json() as { request_id?: string };
      if (!queued.request_id) throw new Error('Pixazo returned no request id.');

      let mediaUrl: string | undefined;
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await wait(5000);
        const statusResponse = await fetch(`${PIXAZO_STATUS_ENDPOINT}/${queued.request_id}`, {
          headers: { 'Ocp-Apim-Subscription-Key': PIXAZO_API_KEY },
        });
        if (!statusResponse.ok) throw new Error(`Pixazo status request failed: ${statusResponse.status}`);
        const statusData = await statusResponse.json() as { status?: string; error?: string; output?: { media_url?: string[] } };
        if (statusData.status === 'COMPLETED') {
          mediaUrl = statusData.output?.media_url?.[0];
          break;
        }
        if (statusData.status === 'FAILED' || statusData.status === 'ERROR') throw new Error(statusData.error || 'Audio generation failed.');
      }
      if (!mediaUrl) throw new Error('Audio generation timed out before completion.');
      await addRemoteAsset(mediaUrl, 'audio', audioPrompt);
      setAudioPrompt('');
      setIsAudioPromptOpen(false);
    } catch (error) {
      console.error(error);
      alert('Failed to generate music. Check console for details.');
    } finally {
      setIsAudioPromptGenerating(false);
    }
  };

  const handleGenerateVideo = async (event: React.FormEvent) => {
    event.preventDefault();
    if ((!prompt.trim() && selectedContextIds.length === 0) || isGenerating) return;

    setIsGenerating(true);
    try {
      const contextAssets = uploadedAssets
        .filter((asset) => selectedContextIds.includes(asset.id) && asset.data)
        .map((asset) => ({ type: asset.type, data: asset.data! }));
      const config = await generateVideoScript(prompt, contextAssets);
      const contextUrls = uploadedAssets
        .filter((asset) => selectedContextIds.includes(asset.id))
        .map((asset) => ({ type: asset.type, url: asset.url }));

      if (config.ttsAudioBase64) {
        const dataUrl = `data:audio/wav;base64,${config.ttsAudioBase64}`;
        contextUrls.push({ type: 'audio', url: dataUrl });
      }

      const component = await compileVideoComponent(config.code);
      setVideos((current) => [{
        id: Math.random().toString(36).slice(2),
        config,
        component,
        status: 'preview',
        prompt,
        contextAssets: contextUrls,
      }, ...current]);
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
    setVideos((current) => current.map((item) => item.id === video.id ? { ...item, status: 'rendering' } : item));
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
        inputProps: { contextAssets: video.contextAssets || [] },
        container: 'webm',
        videoCodec: 'vp8',
        videoBitrate: 1000000,
      });
      const blob = await result.getBlob();
      const url = URL.createObjectURL(blob);
      setVideos((current) => current.map((item) => item.id === video.id ? { ...item, status: 'done', objectUrl: url } : item));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `video-${video.id}.webm`;
      anchor.click();
    } catch (error) {
      console.error(error);
      alert('Render failed. See console.');
      setVideos((current) => current.map((item) => item.id === video.id ? { ...item, status: 'preview' } : item));
    }
  };

  const emptyStateControls = (activeAssetTab === 'image' && isImagePromptOpen) || (activeAssetTab === 'audio' && isAudioPromptOpen)
    ? (
      <form
        className="pointer-events-auto absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-[3px]"
        onSubmit={(event) => {
          event.preventDefault();
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
          onChange={(event) => activeAssetTab === 'image' ? setImagePrompt(event.target.value) : setAudioPrompt(event.target.value)}
          placeholder={activeAssetTab === 'image' ? 'Generate an image...' : 'Generate music...'}
          className="h-[50px] w-[320px] max-w-[calc(100vw-112px)] rounded-full bg-white px-5 text-[14px] font-medium text-black placeholder:text-black/45 focus:outline-none"
          disabled={activeAssetTab === 'image' ? isImagePromptGenerating : isAudioPromptGenerating}
        />
        <button
          type="submit"
          className="h-[50px] w-[60px] rounded-full bg-white text-black flex items-center justify-center disabled:opacity-50"
          disabled={activeAssetTab === 'image' ? (!imagePrompt.trim() || isImagePromptGenerating) : (!audioPrompt.trim() || isAudioPromptGenerating)}
        >
          {(activeAssetTab === 'image' ? isImagePromptGenerating : isAudioPromptGenerating)
            ? <Loader2 size={18} className="animate-spin" />
            : <Wand2 size={18} strokeWidth={2.1} />}
        </button>
      </form>
    )
    : (
      <div className="pointer-events-auto absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-[3px]">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="h-[50px] px-6 rounded-l-full rounded-r-[14px] bg-white text-black flex items-center gap-2"
        >
          <Upload size={18} strokeWidth={2.2} />
          <span className="font-semibold text-[15px]">Upload</span>
        </button>
        <button
          type="button"
          onClick={() => activeAssetTab === 'image' ? setIsImagePromptOpen(true) : setIsAudioPromptOpen(true)}
          className="h-[50px] w-[60px] rounded-l-[14px] rounded-r-full bg-white text-black flex items-center justify-center"
        >
          <Wand2 size={18} strokeWidth={2.1} />
        </button>
      </div>
    );

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden flex flex-col">
      <div className="absolute inset-0 p-6 pt-10 pb-32 overflow-y-auto w-full">
        <div className="flex flex-col gap-12 w-full max-w-[1600px] mx-auto overflow-hidden px-4">
          {videos.length > 0 && (
            <div>
              <h2 className="text-xl font-bold text-white mb-6 px-2 flex items-center gap-2">
                {aspectRatio === '9:16' ? <Smartphone className="w-5 h-5 text-gray-400" /> : <Monitor className="w-5 h-5 text-gray-400" />}
                <span>Generated Videos</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
                {videos.map((video) => (
                  <div key={video.id} className="relative group super-pill-medium overflow-hidden bg-[#111] aspect-video border border-white/5">
                    <Player
                      component={video.component}
                      inputProps={{ contextAssets: video.contextAssets || [] }}
                      durationInFrames={video.config.durationInFrames || 60}
                      compositionWidth={video.config.width || 1280}
                      compositionHeight={video.config.height || 720}
                      fps={video.config.fps || 30}
                      controls
                      loop
                      style={{ width: '100%', height: '100%' }}
                    />
                    <div className="absolute inset-x-0 bottom-0 p-5 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex items-end justify-between z-10">
                      <div className="flex items-center gap-2 text-white/90 min-w-0">
                        <ImageIcon className="w-[18px] h-[18px]" strokeWidth={1.5} />
                        <p className="text-[15px] font-medium leading-none truncate">{video.prompt}</p>
                      </div>
                      <button
                        onClick={() => handleDownload(video)}
                        disabled={video.status === 'rendering'}
                        className="p-2 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md transition-colors disabled:opacity-50"
                      >
                        {video.status === 'rendering' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4 z-50 flex flex-col gap-3">
        {selectedAssets.length > 0 && (
          <div className="flex gap-3 px-4 items-end">
            {selectedAssets.map((asset) => (
              <div key={asset.id} className="relative w-16 h-16 shrink-0 group">
                <div className="w-full h-full rounded-2xl overflow-hidden border border-white/10 bg-[#1A1A1C] shadow-lg">
                  {asset.type === 'image'
                    ? <img src={asset.url} className="w-full h-full object-cover" alt="" />
                    : <div className="w-full h-full bg-[#111] flex items-center justify-center"><AudioLines size={20} className="text-white/50" /></div>}
                </div>
                <button
                  type="button"
                  onClick={(event) => toggleContextAsset(event, asset.id)}
                  className="absolute -top-2 -right-2 bg-[#2A2A2A] border border-white/10 w-6 h-6 flex items-center justify-center rounded-full text-white opacity-0 group-hover:opacity-100 transition-all z-10"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleGenerateVideo} className="flex flex-col justify-center bg-[#18181A] p-2 pl-4 border border-white/5 shadow-2xl relative super-pill-medium" style={{ minHeight: '90px' }}>
          <input
            type="text"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={isGenerating}
            placeholder={selectedContextIds.length > 0 ? 'What do you want to create with these assets?' : 'What do you want to create?'}
            className="w-full bg-transparent text-white placeholder-gray-500/80 text-[15px] focus:outline-none min-w-0 pt-3 pb-8 px-1"
          />

          <div className="flex items-end justify-between absolute bottom-1.5 left-4 right-[5px]">
            <div className="relative" ref={assetPickerRef}>
              <button type="button" onClick={() => setIsAssetPickerOpen((open) => !open)} className="text-gray-400 hover:text-white transition-colors h-8 flex items-center mb-0.5 relative z-10">
                <Plus size={22} strokeWidth={2} />
              </button>

              {isAssetPickerOpen && createPortal(
                <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none">
                  <div ref={assetPickerPopupRef} className="pointer-events-auto w-[800px] h-[500px] max-w-[calc(100vw-32px)] bg-[#1A1A1C] border border-[#2A2A2A] rounded-[24px] p-4 flex flex-col shadow-2xl">
                    <div className="flex items-center gap-3">
                      <div className="flex bg-[#2A2A2A]/50 rounded-[14px] p-1 h-[40px]">
                        <button type="button" onClick={() => setActiveAssetTab('image')} className={`flex items-center gap-2 px-4 h-full rounded-[10px] text-[14px] font-medium ${activeAssetTab === 'image' ? 'bg-[#404040] text-white' : 'text-gray-400 hover:text-white'}`}>
                          <ImageIcon size={16} /> Image
                        </button>
                        <button type="button" onClick={() => setActiveAssetTab('audio')} className={`flex items-center gap-2 px-4 h-full rounded-[10px] text-[14px] font-medium ${activeAssetTab === 'audio' ? 'bg-[#404040] text-white' : 'text-gray-400 hover:text-white'}`}>
                          <AudioLines size={16} /> Audio
                        </button>
                      </div>
                      <div className="flex-1 relative h-[40px]">
                        <input type="text" placeholder="Search for Assets" className="w-full h-full bg-white/5 rounded-[14px] px-4 text-[14px] text-white placeholder-gray-500 focus:outline-none pl-10" />
                        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
                      </div>
                      <button type="button" className="flex items-center gap-1.5 px-4 h-[40px] bg-white/5 text-[14px] font-medium rounded-[14px] text-gray-300">
                        Recent <ChevronDown size={16} className="opacity-70" />
                      </button>
                    </div>

                    <div className="flex gap-4 flex-1 mt-4 relative rounded-[20px] overflow-hidden">
                      <PixelDotsVisualizer activeTab={activeAssetTab} />
                      {uploadedAssets.filter((asset) => asset.type === activeAssetTab).length === 0 ? (
                        <div className="absolute inset-0 z-20 pointer-events-none">
                          <input type="file" ref={fileInputRef} className="hidden" accept={activeAssetTab === 'image' ? 'image/*' : 'audio/*'} onChange={handleFileUpload} />
                          {emptyStateControls}
                        </div>
                      ) : (
                        <div className="w-full h-full relative z-10 bg-[#111]/80 backdrop-blur-md rounded-[16px] overflow-hidden border border-white/5 shadow-xl p-4">
                          <input type="file" ref={fileInputRef} className="hidden" accept={activeAssetTab === 'image' ? 'image/*' : 'audio/*'} onChange={handleFileUpload} />
                          {!selectedAssetId ? (
                            <div className="w-full h-full overflow-y-auto">
                              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 auto-rows-[160px]">
                                {uploadedAssets.filter((asset) => asset.type === activeAssetTab).map((asset) => {
                                  const isSelected = selectedContextIds.includes(asset.id);
                                  return (
                                    <div key={asset.id} onClick={() => setSelectedAssetId(asset.id)} className={`bg-black/50 rounded-[14px] overflow-hidden cursor-pointer flex flex-col border transition-all group relative ${isSelected ? 'border-blue-500' : 'border-white/10 hover:border-white/50'}`}>
                                      <button type="button" onClick={(event) => toggleContextAsset(event, asset.id)} className={`absolute top-2 right-2 z-20 w-8 h-8 rounded-full flex items-center justify-center ${isSelected ? 'bg-blue-500 text-white' : 'bg-black/50 text-white/50 hover:bg-black/80 hover:text-white'}`}>
                                        {isSelected ? <Sparkles size={14} /> : <Plus size={18} />}
                                      </button>
                                      <div className="flex-1 w-full overflow-hidden bg-black flex items-center justify-center">
                                        {asset.type === 'image'
                                          ? <img src={asset.url} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" alt="" />
                                          : <AudioLines size={32} className="text-white/50 group-hover:text-white" />}
                                      </div>
                                      <div className="p-3 bg-[#1A1A1C] border-t border-white/5 truncate text-[13px] font-medium text-gray-300">
                                        {asset.name.replace(/\.[^/.]+$/, '')}
                                      </div>
                                    </div>
                                  );
                                })}
                                <div onClick={() => fileInputRef.current?.click()} className="bg-white/5 rounded-[14px] border border-white/10 border-dashed flex flex-col items-center justify-center cursor-pointer hover:bg-white/10 transition-colors text-white/50 hover:text-white group">
                                  <Upload size={28} strokeWidth={1.5} className="mb-2" />
                                  <span className="text-[14px] font-medium">Upload More</span>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="w-full h-full relative flex flex-col bg-black rounded-xl overflow-hidden border border-white/10 group">
                              <div className="absolute top-4 left-4 z-20">
                                <button onClick={() => setSelectedAssetId(null)} className="bg-black/50 border border-white/20 w-10 h-10 flex items-center justify-center rounded-full text-white">
                                  <ArrowLeft size={20} />
                                </button>
                              </div>
                              <div className="absolute top-4 right-4 z-20">
                                <button onClick={(event) => toggleContextAsset(event, selectedAssetId)} className="px-4 h-10 flex items-center gap-2 rounded-full font-medium bg-black/50 text-white border border-white/20">
                                  {selectedContextIds.includes(selectedAssetId) ? <><Sparkles size={16} /> Added</> : <><Plus size={16} /> Add to Context</>}
                                </button>
                              </div>
                              <div className="flex-1 flex items-center justify-center">
                                {uploadedAssets.find((asset) => asset.id === selectedAssetId)?.type === 'image'
                                  ? <img src={uploadedAssets.find((asset) => asset.id === selectedAssetId)?.url} className="w-full h-full object-contain" alt="" />
                                  : <div className="w-full h-full flex items-center justify-center bg-[#111]"><audio src={uploadedAssets.find((asset) => asset.id === selectedAssetId)?.url} controls className="w-3/4 outline-none" /></div>}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>,
                document.body,
              )}
            </div>

            <div className="flex items-end gap-2">
              <div className="hidden sm:flex gap-2">
                <button type="button" onClick={() => setAspectRatio('16:9')} className={`h-8 px-3 rounded-full border border-white/10 ${aspectRatio === '16:9' ? 'bg-white text-black' : 'bg-white/5 text-gray-300'}`}>16:9</button>
                <button type="button" onClick={() => setAspectRatio('9:16')} className={`h-8 px-3 rounded-full border border-white/10 ${aspectRatio === '9:16' ? 'bg-white text-black' : 'bg-white/5 text-gray-300'}`}>9:16</button>
              </div>
              <button type="submit" disabled={isGenerating || !prompt.trim()} className="bg-white text-black h-[34px] w-[34px] rounded-full disabled:opacity-50 flex items-center justify-center shadow-md">
                {isGenerating ? <Loader2 className="w-4 h-4 animate-spin text-black" /> : <ArrowRight className="w-4 h-4" strokeWidth={2.5} />}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
