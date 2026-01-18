/**
 * Integration Example
 * Shows how to integrate Sustainability Analysis into your existing UI
 */

import React, { useState, useEffect } from 'react';
import { SustainabilityAnalysis } from '../components/SustainabilityAnalysis';
import { AlternativeVideos } from '../components/AlternativeVideos';
import { generateSustainabilityInsights } from '../utils/sustainabilityAnalysis';
import { SustainabilityInsights, VideoMetadata } from '../types/sustainability';

// Example: How to integrate into your main panel component
interface MainPanelProps {
  videoId: string;
  transcript: string | null;
  channelData: {
    subscriberCount: number;
    name: string;
    videoTitle: string;
    description: string;
    hasSponsor?: boolean;
  };
  alternativeVideos: Array<{
    videoId: string;
    title: string;
    channelTitle: string;
    thumbnail: string;
    subscriberCount: number;
    viewCount?: number;
  }>;
  biasData: any; // Your existing bias analysis data
}

export const MainPanel: React.FC<MainPanelProps> = ({
  videoId,
  transcript,
  channelData,
  alternativeVideos,
  biasData,
}) => {
  const [sustainabilityInsights, setSustainabilityInsights] = useState<SustainabilityInsights | null>(null);
  const [isSustainabilityContent, setIsSustainabilityContent] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Check if content is sustainability-related
  const checkSustainabilityKeywords = (text: string): boolean => {
    if (!text || text.length < 50) return false;
    
    const textLower = text.toLowerCase();
    const keywords = [
      'climate', 'sustainable', 'sustainability', 'carbon', 'emission',
      'renewable', 'green energy', 'environment', 'eco-friendly', 'net zero',
      'esg', 'greenhouse', 'biodiversity', 'conservation', 'decarbonization'
    ];
    
    const matches = keywords.filter(kw => textLower.includes(kw));
    return matches.length >= 2; // Need at least 2 keywords
  };

  useEffect(() => {
    if (!transcript) {
      setIsSustainabilityContent(false);
      setSustainabilityInsights(null);
      return;
    }

    const isSustainability = checkSustainabilityKeywords(transcript);
    setIsSustainabilityContent(isSustainability);

    if (isSustainability) {
      setIsAnalyzing(true);
      
      // Generate insights (this is fast, < 100ms)
      try {
        const metadata: VideoMetadata = {
          channelSize: channelData.subscriberCount,
          channelName: channelData.name,
          videoTitle: channelData.videoTitle,
          videoDescription: channelData.description,
          hasSponsor: channelData.hasSponsor || false,
        };

        const insights = generateSustainabilityInsights(transcript, metadata);
        setSustainabilityInsights(insights);
      } catch (error) {
        console.error('Error generating sustainability insights:', error);
      } finally {
        setIsAnalyzing(false);
      }
    } else {
      setSustainabilityInsights(null);
    }
  }, [transcript, channelData]);

  return (
    <div className="main-panel">
      {/* Your existing bias analysis component */}
      {/* <BiasAnalysis data={biasData} /> */}

      {/* Sustainability Analysis - Only shows if sustainability content detected */}
      {isSustainabilityContent && (
        <SustainabilityAnalysis
          insights={sustainabilityInsights!}
          transcript={transcript || undefined}
          isLoading={isAnalyzing}
        />
      )}

      {/* Alternative Videos - Enhanced with sustainability mode */}
      <AlternativeVideos
        videos={alternativeVideos}
        isSustainabilityMode={isSustainabilityContent}
        title={isSustainabilityContent ? 'Alternative Perspectives' : 'Under-represented Voices'}
      />
    </div>
  );
};

/**
 * Alternative: If you want to cache results per video
 */
const insightsCache = new Map<string, SustainabilityInsights>();

export function getCachedInsights(
  videoId: string,
  transcript: string,
  metadata: VideoMetadata
): SustainabilityInsights | null {
  const cacheKey = `${videoId}_${transcript.length}`;
  
  if (insightsCache.has(cacheKey)) {
    return insightsCache.get(cacheKey)!;
  }

  const insights = generateSustainabilityInsights(transcript, metadata);
  insightsCache.set(cacheKey, insights);
  
  // Limit cache size
  if (insightsCache.size > 50) {
    const firstKey = insightsCache.keys().next().value;
    insightsCache.delete(firstKey);
  }

  return insights;
}

/**
 * Example: Standalone usage without React
 */
export function analyzeSustainabilityStandalone(
  transcript: string,
  channelSize: number,
  channelName: string,
  videoTitle: string,
  videoDescription: string,
  hasSponsor: boolean = false
) {
  const metadata: VideoMetadata = {
    channelSize,
    channelName,
    videoTitle,
    videoDescription,
    hasSponsor,
  };

  return generateSustainabilityInsights(transcript, metadata);
}

