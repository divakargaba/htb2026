/**
 * Alternative Videos Component (Enhanced with Sustainability Tags)
 * Displays silenced/alternative videos with sustainability-specific tags when in sustainability mode
 */

import React from 'react';
import './AlternativeVideos.css';

interface Video {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
  subscriberCount: number;
  viewCount?: number;
  isRisingSignal?: boolean;
}

interface AlternativeVideosProps {
  videos: Video[];
  isSustainabilityMode?: boolean;
  title?: string;
}

export const AlternativeVideos: React.FC<AlternativeVideosProps> = ({
  videos,
  isSustainabilityMode = false,
  title,
}) => {
  const getSustainabilityTag = (video: Video): { icon: string; label: string; color: string } | null => {
    if (!isSustainabilityMode) return null;

    const subs = video.subscriberCount;
    const titleLower = video.title.toLowerCase();
    const channelLower = video.channelTitle.toLowerCase();

    // Community Voice (small channels)
    if (subs < 10000) {
      return {
        icon: '🌍',
        label: 'Community Voice',
        color: '#059669',
      };
    }

    // Research-Based (academic keywords)
    const academicKeywords = ['research', 'study', 'university', 'professor', 'phd', 'scientist', 'journal'];
    if (academicKeywords.some(keyword => titleLower.includes(keyword) || channelLower.includes(keyword))) {
      return {
        icon: '🔬',
        label: 'Research-Based',
        color: '#10B981',
      };
    }

    // Independent Analysis (critical/independent keywords)
    const independentKeywords = ['critical', 'analysis', 'investigation', 'independent', 'non-profit', 'ngo'];
    if (independentKeywords.some(keyword => titleLower.includes(keyword) || channelLower.includes(keyword))) {
      return {
        icon: '⚖️',
        label: 'Independent Analysis',
        color: '#3B82F6',
      };
    }

    // Grassroots (very small channels)
    if (subs < 5000) {
      return {
        icon: '🌱',
        label: 'Grassroots',
        color: '#059669',
      };
    }

    return null;
  };

  const sortedVideos = isSustainabilityMode
    ? [...videos].sort((a, b) => {
        // Prioritize videos with sustainability tags
        const tagA = getSustainabilityTag(a);
        const tagB = getSustainabilityTag(b);
        if (tagA && !tagB) return -1;
        if (!tagA && tagB) return 1;
        return 0;
      })
    : videos;

  const displayTitle = title || (isSustainabilityMode ? 'Alternative Perspectives' : 'Under-represented Voices');

  return (
    <div className="alternative-videos">
      <div className="videos-header">
        <h3 className="videos-title">{displayTitle}</h3>
        {isSustainabilityMode && (
          <span className="sustainability-badge">🌍 Sustainability Mode</span>
        )}
      </div>

      {videos.length === 0 ? (
        <div className="no-videos">
          <p>No alternative videos found for this topic.</p>
        </div>
      ) : (
        <div className="videos-grid">
          {sortedVideos.slice(0, 5).map((video) => {
            const tag = getSustainabilityTag(video);
            return (
              <a
                key={video.videoId}
                href={`https://www.youtube.com/watch?v=${video.videoId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="video-card"
              >
                <div className="video-thumbnail-container">
                  <img
                    src={video.thumbnail}
                    alt={video.title}
                    className="video-thumbnail"
                  />
                  {video.isRisingSignal && (
                    <span className="rising-badge">📈 Rising</span>
                  )}
                  {tag && (
                    <span
                      className="sustainability-tag"
                      style={{ backgroundColor: tag.color + '20', color: tag.color }}
                    >
                      {tag.icon} {tag.label}
                    </span>
                  )}
                </div>
                <div className="video-info">
                  <h4 className="video-title">{video.title}</h4>
                  <p className="video-channel">{video.channelTitle}</p>
                  <p className="video-meta">
                    {formatNumber(video.subscriberCount)} subscribers
                    {video.viewCount && ` · ${formatNumber(video.viewCount)} views`}
                  </p>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
};

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

