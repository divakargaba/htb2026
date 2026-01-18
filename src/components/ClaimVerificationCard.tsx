/**
 * Claim Verification Card Component
 * Displays extracted claims with verification status
 */

import React, { useState } from 'react';
import { ClaimVerification } from '../types/sustainability';
import './SustainabilityCard.css';

interface ClaimVerificationCardProps {
  verification: ClaimVerification;
}

export const ClaimVerificationCard: React.FC<ClaimVerificationCardProps> = ({
  verification,
}) => {
  const { totalClaims, verifiedClaims, claims } = verification;
  const [expanded, setExpanded] = useState(false);

  const verificationRate =
    totalClaims > 0 ? Math.round((verifiedClaims / totalClaims) * 100) : 0;

  return (
    <div className="sustainability-card">
      <div className="card-header">
        <div className="card-title">
          <span className="card-icon">🔍</span>
          <h3>Claim Verification</h3>
        </div>
        <div className="verification-stats">
          <span className="stat-value">{verifiedClaims}</span>
          <span className="stat-label">/{totalClaims} verified</span>
        </div>
      </div>

      <div className="card-content">
        {/* Verification Rate Bar */}
        <div className="verification-bar-container">
          <div className="verification-bar">
            <div
              className="verification-fill"
              style={{ width: `${verificationRate}%` }}
            />
          </div>
          <div className="verification-percentage">{verificationRate}%</div>
        </div>

        {totalClaims === 0 ? (
          <div className="no-claims">
            <p>No specific sustainability claims detected in transcript.</p>
            <p className="hint">Claims are sentences containing commitments, targets, or metrics.</p>
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="verification-summary">
              {verificationRate >= 70 ? (
                <p className="summary-good">
                  ✅ Most claims are supported by evidence
                </p>
              ) : verificationRate >= 40 ? (
                <p className="summary-warning">
                  ⚠️ Some claims lack supporting evidence
                </p>
              ) : (
                <p className="summary-danger">
                  ❌ Many claims lack supporting evidence
                </p>
              )}
            </div>

            {/* Claims List */}
            {claims.length > 0 && (
              <div className="claims-section">
                <button
                  className="expand-button"
                  onClick={() => setExpanded(!expanded)}
                  aria-expanded={expanded}
                >
                  <span>
                    {expanded ? 'Hide' : 'Show'} Claims ({claims.length})
                  </span>
                  <span className={`expand-arrow ${expanded ? 'expanded' : ''}`}>
                    ▼
                  </span>
                </button>

                {expanded && (
                  <div className="claims-list">
                    {claims.map((claim, index) => (
                      <div
                        key={index}
                        className={`claim-item ${claim.verified ? 'verified' : 'unverified'}`}
                      >
                        <div className="claim-status">
                          {claim.verified ? (
                            <span className="status-icon verified-icon">✅</span>
                          ) : (
                            <span className="status-icon unverified-icon">❌</span>
                          )}
                        </div>
                        <div className="claim-content">
                          <p className="claim-text">"{claim.text}"</p>
                          {claim.verified && claim.evidence && (
                            <p className="claim-evidence">{claim.evidence}</p>
                          )}
                          {!claim.verified && claim.issue && (
                            <p className="claim-issue">{claim.issue}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

