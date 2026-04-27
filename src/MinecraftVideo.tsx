import React from 'react';
import { AbsoluteFill, useVideoConfig, useCurrentFrame, interpolate, spring, Sequence } from 'remotion';

export interface Scene {
  text: string;
  durationInFrames: number;
}

export interface VideoProps {
  backgroundColor: string;
  textColor: string;
  scenes: Scene[];
}

export const MinecraftVideo: React.FC<VideoProps> = ({ backgroundColor, textColor, scenes }) => {
  const { fps, width, height } = useVideoConfig();
  const frame = useCurrentFrame();

  let accumulatedFrames = 0;

  return (
    <AbsoluteFill style={{ backgroundColor, fontFamily: '"Press Start 2P", monospace' }}>
      {scenes.map((scene, index) => {
        const startFrame = accumulatedFrames;
        accumulatedFrames += scene.durationInFrames;
        
        return (
          <Sequence key={index} from={startFrame} durationInFrames={scene.durationInFrames}>
            <SceneContent scene={scene} textColor={textColor} fps={fps} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const SceneContent: React.FC<{ scene: Scene, textColor: string, fps: number }> = ({ scene, textColor, fps }) => {
  const frame = useCurrentFrame();
  
  // A simple blocky bounce animation
  const bounce = spring({
    frame,
    fps,
    config: {
      damping: 10,
      stiffness: 100,
      mass: 0.5,
    },
  });

  const scale = interpolate(bounce, [0, 1], [0.8, 1]);
  const opacity = interpolate(frame, [0, 10, scene.durationInFrames - 10, scene.durationInFrames], [0, 1, 1, 0]);

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div
        style={{
          color: textColor,
          fontSize: '48px',
          textAlign: 'center',
          transform: `scale(${scale})`,
          opacity,
          padding: '40px',
          textShadow: `6px 6px 0px rgba(0, 0, 0, 0.4)`,
          lineHeight: '1.4'
        }}
      >
        {scene.text}
      </div>
    </AbsoluteFill>
  );
};
