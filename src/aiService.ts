import { GoogleGenAI, Type } from "@google/genai";
import * as Babel from "@babel/standalone";
import React from "react";
import * as Remotion from "remotion";

export interface GeneratedVideoConfig {
  code: string;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  voiceoverScript?: string;
  ttsAudioBase64?: string;
}

export interface ContextAsset {
  type: 'image' | 'audio';
  data: string; // base64 string
}

export type GeminiVideoModel = 'gemini-3.1-flash-lite-preview' | 'gemini-3-flash-preview' | 'gemini-3.1-pro-preview';

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function pcmBase64ToWavBase64(pcmBase64: string, sampleRate = 24000, numChannels = 1): string {
  const binaryString = atob(pcmBase64);
  const pcmData = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    pcmData[i] = binaryString.charCodeAt(i);
  }

  const byteRate = sampleRate * numChannels * 2;
  const buffer = new ArrayBuffer(44 + pcmData.length);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcmData.length, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, numChannels * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, pcmData.length, true);

  // write PCM data
  new Uint8Array(buffer, 44).set(pcmData);

  // Convert buffer to Base64
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function generateVideoScript(
  prompt: string,
  contextAssets: ContextAsset[] = [],
  model: GeminiVideoModel = 'gemini-3-flash-preview',
): Promise<GeneratedVideoConfig> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is missing.");
  }
  
  const ai = new GoogleGenAI({ apiKey });

  const aiContent = [
    { text: [
      'Turn this prompt into a short video script for a Minecraft-themed aesthetic video using Remotion and React.',
      'Prompt: "' + prompt + '"',
      '',
      'Requirements:',
      '1. You must write the actual React Remotion component code.',
      '2. The main component must be named `GeneratedVideo`.',
      "3. You MUST use ES6 imports. For external libraries (like three.js, framer-motion, canvas-confetti, etc.), import them normally (e.g., `import * as THREE from 'three'` or `import confetti from 'canvas-confetti'`). We will automatically resolve them via esm.sh.",
      "4. Always import React: `import React from 'react'`. Always import Remotion hooks/components from 'remotion'.",
      '5. Keep the component styling "Minecraft-themed" (pixelated fonts, blocks, etc. using standard HTML/CSS or inline styles).',
      '6. Export your main component as default: `export default function GeneratedVideo({ contextAssets = [] }: { contextAssets?: { type: string, url: string }[] }) { ... }`.',
      '7. Output valid TSX code.',
      '8. If I provide context images/audio with this prompt, the `contextAssets` prop will contain their URLs. There are ' + contextAssets.length + ' context assets provided. **You MUST display and use ALL of them in your video.** Use them in your video using `<Img src="..." />` or `<Audio src="..." />` from remotion. For example, if there is an image, display it prominently like: `<Img src={contextAssets[0].url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />`. If there is audio, play it: `<Audio src={contextAssets[contextAssets.length-1].url} />`.',
      '9. When using `interpolate` in Remotion, ensure that the `inputRange` array is strictly monotonically increasing (e.g., `[0, 100]`, not `[100, 0]`).',
      '10. If the user mentions or it feels appropriate to have a voiceover narrator, output the spoken text in the `voiceoverScript` property. We will automatically generate speech and inject it as another `contextAsset` at the END of the array. Keep it short (few seconds). Assume there will be an audio asset appended!',
    ].join('\n') }
  ];

  for (const asset of contextAssets) {
    if (asset.type === 'image') {
      const match = asset.data.match(/^data:(image\/[a-zA-Z]+);base64,(.*)$/);
      if (match) {
        aiContent.push({
          inlineData: {
            data: match[2],
            mimeType: match[1]
          }
        });
      }
    } else if (asset.type === 'audio') {
      const match = asset.data.match(/^data:(audio\/[a-zA-Z0-9.\-]+);base64,(.*)$/);
      if (match) {
        aiContent.push({
          inlineData: {
            data: match[2],
            mimeType: match[1]
          }
        });
      }
    }
  }

  const response = await ai.models.generateContent({
    model,
    contents: aiContent,
    config: {
      temperature: 0,
      topP: 0,
      topK: 1,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          code: {
            type: Type.STRING,
            description: "The React TSX code for the component. Must declare and default export the component.",
          },
          durationInFrames: { type: Type.INTEGER },
          fps: { type: Type.INTEGER },
          width: { type: Type.INTEGER },
          height: { type: Type.INTEGER },
          voiceoverScript: { type: Type.STRING, description: "Text to be spoken by a text-to-speech voiceover, if needed." }
        },
        required: ["code", "durationInFrames", "fps", "width", "height"]
      }
    }
  });

  const jsonStr = response.text.trim();
  const parsed = JSON.parse(jsonStr) as GeneratedVideoConfig;

  // If there's a voiceover script, generate TTS audio.
  if (parsed.voiceoverScript && parsed.voiceoverScript.trim()) {
    try {
      const ttsResponse = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: parsed.voiceoverScript }] }],
        config: {
          responseModalities: ["AUDIO" as any], // Use string literal to avoid Modality import issue
          speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Kore' },
              },
          },
        },
      });

      const base64Pcm = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Pcm) {
        parsed.ttsAudioBase64 = pcmBase64ToWavBase64(base64Pcm, 24000, 1);
      }
    } catch (e) {
      console.error("Failed to generate TTS:", e);
    }
  }

  return parsed;
}

export async function compileVideoComponent(code: string): Promise<React.FC> {
  const imports: Record<string, any> = {
    react: React,
    remotion: Remotion,
  };

  const importRegex = /import\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(code)) !== null) {
    const importSource = match[1];
    if (!imports[importSource]) {
      try {
        const url = importSource.startsWith('http') ? importSource : `https://esm.sh/${importSource}`;
        
        console.log("Dynamically importing:", url);
        // @ts-ignore
        imports[importSource] = await import(/* @vite-ignore */ url);
      } catch (e) {
        console.warn(`Failed to dynamically import ${importSource}`, e);
      }
    }
  }

  const transpiled = Babel.transform(code, {
    presets: ["env", "react", "typescript"],
    filename: "video.tsx",
  }).code;

  if (!transpiled) {
    throw new Error("Failed to transpile code");
  }

  const fakeRequire = (name: string) => {
    if (imports[name]) return imports[name];
    console.warn(`Module ${name} not found in pre-loaded imports`);
    return {};
  };

  const exportsObj: any = {};
  const createComponent = new Function("require", "exports", "React", "Remotion", transpiled);
  
  try {
    createComponent(fakeRequire, exportsObj, React, Remotion);
  } catch (e) {
    console.error("Error executing transpiled code:", e);
    throw e;
  }
  
  return exportsObj.default || exportsObj.GeneratedVideo || Object.values(exportsObj)[0] as React.FC;
}
