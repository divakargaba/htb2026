/**
 * Sustainability Analysis Main Component
 * Container component that displays all sustainability insights
 */

import React, { useState } from 'react';
import { SustainabilityInsights } from '../types/sustainability';
import { GreenwashingCard } from './GreenwashingCard';
import { ClaimVerificationCard } from './ClaimVerificationCard';
import { SourceCredibilityCard } from './SourceCredibilityCard';
import './SustainabilityAnalysis.css';

interface SustainabilityAnalysisProps {
  insights: SustainabilityInsights;
  transcript?: string;
  isLoading?: boolean;
}

export const SustainabilityAnalysis: React.FC<SustainabilityAnalysisProps> = ({
  insights,
  transcript,
  isLoading = false,
}) => {
  const [expanded, setExpanded] = useState(false);

  if (isLoading) {
    return (
      <div className="sustainability-analysis loading">
        <div className="loading-spinner" />
        <p>Analyzing sustainability content...</p>
      </div>
    );
  }

  if (!transcript || transcript.length < 50) {
    return (
      <div className="sustainability-analysis limited">
        <div className="limited-message">
          <span className="limited-icon">ℹ️</span>
          <p>Analysis limited without transcript</p>
          <p className="hint">
            Transcript data is needed for detailed sustainability analysis
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="sustainability-analysis">
      <button
        className="sustainability-header"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label="Toggle sustainability analysis"
      >
        <div className="header-content">
          <div className="header-left">
            <span className="header-icon">🌍</span>
            <div>
              <h2 className="header-title">Sustainability Analysis</h2>
              <p className="header-subtitle">
                Greenwashing detection, claim verification, and source credibility
              </p>
            </div>
          </div>
          <span className={`expand-icon ${expanded ? 'expanded' : ''}`}>
            ▼
          </span>
        </div>
      </button>

      {expanded && (
        <div className="sustainability-content">
          <div className="cards-grid">
            <GreenwashingCard risk={insights.greenwashingRisk} />
            <ClaimVerificationCard verification={insights.claimVerification} />
            <SourceCredibilityCard credibility={insights.sourceCredibility} />
          </div>
        </div>
      )}
    </div>
  );
};

