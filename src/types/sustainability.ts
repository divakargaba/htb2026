/**
 * Sustainability Analysis Types
 * Type definitions for sustainability content analysis
 */

export interface VideoMetadata {
  channelSize: number; // Subscriber count
  channelName: string;
  videoTitle: string;
  videoDescription: string;
  hasSponsor: boolean;
  categoryId?: string;
  publishedAt?: string;
}

export interface GreenwashingRisk {
  score: number; // 0-100 (higher = more risk)
  level: 'LOW' | 'MODERATE' | 'HIGH';
  issues: string[]; // List of problems found
  positives: string[]; // List of good signals
}

export interface Claim {
  text: string;
  verified: boolean;
  issue?: string;
  evidence?: string;
}

export interface ClaimVerification {
  totalClaims: number;
  verifiedClaims: number;
  claims: Claim[];
}

export interface SourceCredibility {
  type: 'CORPORATE' | 'INDEPENDENT' | 'COMMUNITY' | 'UNKNOWN';
  credibilityLevel: 'LOW' | 'MODERATE' | 'HIGH';
  conflicts: string[];
  recommendation: string;
}

export interface SustainabilityInsights {
  greenwashingRisk: GreenwashingRisk;
  claimVerification: ClaimVerification;
  sourceCredibility: SourceCredibility;
}

export interface SustainabilityAnalysisProps {
  insights: SustainabilityInsights;
  transcript?: string;
  isLoading?: boolean;
}

