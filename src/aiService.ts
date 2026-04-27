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
  data: string;
}

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

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcmData.length, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, pcmData.length, true);
  new Uint8Array(buffer, 44).set(pcmData);

  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function generateVideoScript(prompt: string, contextAssets: ContextAsset[] = []): Promise<GeneratedVideoConfig> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is missing.');
  }

  const ai = new GoogleGenAI({ apiKey });
  const aiContent: any[] = [
    {
      text: [
        'Turn this prompt into a short video script for a Minecraft-themed aesthetic video using Remotion and React.',
        `Prompt: "${prompt}"`,
        '',
        'Requirements:',
        '1. Write the actual React Remotion component code.',
        '2. The main component must be named `GeneratedVideo`.',
        '3. Use ES6 imports.',
        '4. Always import React and Remotion hooks/components.',
        '5. Keep the component styling Minecraft-themed.',
        '6. Export your main component as default and accept `contextAssets`.',
        '7. Output valid TSX code.',
        `8. There are ${contextAssets.length} context assets provided and you must use all of them.`,
        '9. Remotion interpolate input ranges must be strictly increasing.',
        '10. If voiceover is appropriate, output a short `voiceoverScript`.',
      ].join('\n'),
    },
  ];

  for (const asset of contextAssets) {
    const match = asset.data.match(/^data:([^;]+);base64,(.*)$/);
    if (match) {
      aiContent.push({
        inlineData: {
          data: match[2],
          mimeType: match[1],
        },
      });
    }
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-pro-preview',
    contents: aiContent,
    config: {
      temperature: 0,
      topP: 0,
      topK: 1,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          code: { type: Type.STRING },
          durationInFrames: { type: Type.INTEGER },
          fps: { type: Type.INTEGER },
          width: { type: Type.INTEGER },
          height: { type: Type.INTEGER },
          voiceoverScript: { type: Type.STRING },
        },
        required: ['code', 'durationInFrames', 'fps', 'width', 'height'],
      },
    },
  });

  const parsed = JSON.parse(response.text.trim()) as GeneratedVideoConfig;

  if (parsed.voiceoverScript?.trim()) {
    try {
      const ttsResponse = await ai.models.generateContent({
        model: 'gemini-3.1-flash-tts-preview',
        contents: [{ parts: [{ text: parsed.voiceoverScript }] }],
        config: {
          responseModalities: ['AUDIO' as any],
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
    } catch (error) {
      console.error('Failed to generate TTS:', error);
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
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(code)) !== null) {
    const importSource = match[1];
    if (!imports[importSource]) {
      try {
        const url = importSource.startsWith('http') ? importSource : `https://esm.sh/${importSource}`;
        imports[importSource] = await import(/* @vite-ignore */ url);
      } catch (error) {
        console.warn(`Failed to dynamically import ${importSource}`, error);
      }
    }
  }

  const transpiled = Babel.transform(code, {
    presets: ['env', 'react', 'typescript'],
    filename: 'video.tsx',
  }).code;

  if (!transpiled) {
    throw new Error('Failed to transpile code');
  }

  const fakeRequire = (name: string) => imports[name] || {};
  const exportsObj: any = {};
  const createComponent = new Function('require', 'exports', 'React', 'Remotion', transpiled);
  createComponent(fakeRequire, exportsObj, React, Remotion);
  return (exportsObj.default || exportsObj.GeneratedVideo || Object.values(exportsObj)[0]) as React.FC;
}
