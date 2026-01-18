/**
 * Source Credibility Card Component
 * Displays source type analysis and credibility assessment
 */

import React from 'react';
import { SourceCredibility } from '../types/sustainability';
import './SustainabilityCard.css';

interface SourceCredibilityCardProps {
  credibility: SourceCredibility;
}

export const SourceCredibilityCard: React.FC<SourceCredibilityCardProps> = ({
  credibility,
}) => {
  const { type, credibilityLevel, conflicts, recommendation } = credibility;

  const getTypeIcon = () => {
    switch (type) {
      case 'CORPORATE':
        return '🏢';
      case 'INDEPENDENT':
        return '🔬';
      case 'COMMUNITY':
        return '🌍';
      default:
        return '❓';
    }
  };

  const getTypeColor = () => {
    switch (type) {
      case 'CORPORATE':
        return '#F59E0B';
      case 'INDEPENDENT':
        return '#10B981';
      case 'COMMUNITY':
        return '#059669';
      default:
        return '#6B7280';
    }
  };

  const getCredibilityColor = () => {
    switch (credibilityLevel) {
      case 'HIGH':
        return '#10B981';
      case 'MODERATE':
        return '#F59E0B';
      case 'LOW':
        return '#EF4444';
    }
  };

  return (
    <div className="sustainability-card">
      <div className="card-header">
        <div className="card-title">
          <span className="card-icon">📊</span>
          <h3>Source Credibility</h3>
        </div>
        <div
          className="credibility-badge"
          style={{ backgroundColor: getCredibilityColor() + '20', color: getCredibilityColor() }}
        >
          {credibilityLevel}
        </div>
      </div>

      <div className="card-content">
        {/* Source Type */}
        <div className="source-type-section">
          <div className="source-type-header">
            <span className="source-type-icon">{getTypeIcon()}</span>
            <span
              className="source-type-label"
              style={{ color: getTypeColor() }}
            >
              {type}
            </span>
          </div>
        </div>

        {/* Recommendation */}
        <div className="recommendation-section">
          <h4 className="section-title">💡 Recommendation</h4>
          <p className="recommendation-text">{recommendation}</p>
        </div>

        {/* Conflicts */}
        {conflicts.length > 0 && (
          <div className="conflicts-section">
            <h4 className="section-title">⚠️ Potential Conflicts</h4>
            <ul className="conflicts-list">
              {conflicts.map((conflict, index) => (
                <li key={index} className="conflict-item">
                  {conflict}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Credibility Level Indicator */}
        <div className="credibility-indicator">
          <div className="indicator-bar">
            <div
              className="indicator-fill"
              style={{
                width: `${
                  credibilityLevel === 'HIGH'
                    ? 100
                    : credibilityLevel === 'MODERATE'
                    ? 60
                    : 30
                }%`,
                backgroundColor: getCredibilityColor(),
              }}
            />
          </div>
          <div className="indicator-labels">
            <span className={credibilityLevel === 'LOW' ? 'active' : ''}>
              Low
            </span>
            <span className={credibilityLevel === 'MODERATE' ? 'active' : ''}>
              Moderate
            </span>
            <span className={credibilityLevel === 'HIGH' ? 'active' : ''}>
              High
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

