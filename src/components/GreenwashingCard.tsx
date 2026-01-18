/**
 * Greenwashing Risk Card Component
 * Displays greenwashing risk analysis with score and issues
 */

import React from 'react';
import { GreenwashingRisk } from '../types/sustainability';
import './SustainabilityCard.css';

interface GreenwashingCardProps {
  risk: GreenwashingRisk;
}

export const GreenwashingCard: React.FC<GreenwashingCardProps> = ({ risk }) => {
  const { score, level, issues, positives } = risk;

  // Calculate progress color based on risk level
  const getColor = () => {
    if (level === 'HIGH') return '#EF4444'; // red
    if (level === 'MODERATE') return '#F59E0B'; // yellow
    return '#10B981'; // green
  };

  // Calculate circumference for circular progress
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="sustainability-card">
      <div className="card-header">
        <div className="card-title">
          <span className="card-icon">⚠️</span>
          <h3>Greenwashing Risk</h3>
        </div>
        <div className={`risk-badge risk-${level.toLowerCase()}`}>
          {level}
        </div>
      </div>

      <div className="card-content">
        {/* Circular Progress Score */}
        <div className="score-circle-container">
          <svg className="score-circle" width="100" height="100">
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke="#262626"
              strokeWidth="8"
            />
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={getColor()}
              strokeWidth="8"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              transform="rotate(-90 50 50)"
              className="score-progress"
            />
          </svg>
          <div className="score-text">
            <span className="score-value">{score}</span>
            <span className="score-label">/100</span>
          </div>
        </div>

        {/* Issues List */}
        {issues.length > 0 && (
          <div className="issues-section">
            <h4 className="section-title">⚠️ Issues Found</h4>
            <ul className="issues-list">
              {issues.map((issue, index) => (
                <li key={index} className="issue-item">
                  {issue}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Positives List */}
        {positives.length > 0 && (
          <div className="positives-section">
            <h4 className="section-title">✅ Positive Signals</h4>
            <ul className="positives-list">
              {positives.map((positive, index) => (
                <li key={index} className="positive-item">
                  {positive}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

