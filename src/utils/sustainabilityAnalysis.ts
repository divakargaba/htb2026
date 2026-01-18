/**
 * Sustainability Analysis Utilities
 * Functions to analyze transcript and metadata for sustainability insights
 */

import {
  GreenwashingRisk,
  ClaimVerification,
  SourceCredibility,
  VideoMetadata,
  Claim,
} from '../types/sustainability';

// Vague sustainability terms that need evidence
const VAGUE_TERMS = [
  'eco-friendly',
  'green',
  'sustainable',
  'carbon neutral',
  'carbon negative',
  'net zero',
  'climate positive',
  'environmentally friendly',
  'planet-friendly',
  'earth-friendly',
  'clean',
  'natural',
  'organic',
  'renewable',
  'zero waste',
  'circular',
];

// Evidence indicators that support claims
const EVIDENCE_WORDS = [
  'data',
  'verified',
  'certified',
  'study',
  'research',
  'report',
  'audit',
  'third-party',
  'peer-reviewed',
  'scientific',
  'evidence',
  'proof',
  'measured',
  'calculated',
  'methodology',
  'source',
  'citation',
  'reference',
  'according to',
  'ipcc',
  'un',
  'epa',
  'who',
];

// Corporate/marketing signals
const CORPORATE_SIGNALS = [
  'sponsored',
  'partner',
  'ad',
  'paid',
  'collab',
  'brought to you by',
  'in collaboration with',
  'brand',
  'campaign',
  'initiative',
  'commitment',
  'pledge',
  'corporate',
  'company',
  'business',
];

// Academic/research keywords
const ACADEMIC_KEYWORDS = [
  'research',
  'study',
  'paper',
  'journal',
  'peer-reviewed',
  'university',
  'professor',
  'phd',
  'doctor',
  'scientist',
  'researcher',
  'analysis',
  'data',
  'findings',
];

// Independent/critical keywords
const INDEPENDENT_KEYWORDS = [
  'critical',
  'analysis',
  'investigation',
  'expose',
  'uncover',
  'reveal',
  'independent',
  'non-profit',
  'ngo',
  'activist',
  'advocacy',
];

/**
 * Analyze transcript for greenwashing signals
 */
export function analyzeGreenwashing(
  transcript: string,
  metadata: VideoMetadata
): GreenwashingRisk {
  if (!transcript || transcript.length < 50) {
    return {
      score: 50,
      level: 'MODERATE',
      issues: ['Insufficient transcript data for analysis'],
      positives: [],
    };
  }

  const transcriptLower = transcript.toLowerCase();
  const issues: string[] = [];
  const positives: string[] = [];

  // Count vague terms
  const vagueMatches = VAGUE_TERMS.filter((term) =>
    transcriptLower.includes(term)
  );
  const vagueCount = vagueMatches.length;

  // Count evidence words
  const evidenceMatches = EVIDENCE_WORDS.filter((term) =>
    transcriptLower.includes(term)
  );
  const evidenceCount = evidenceMatches.length;

  // Check for corporate signals
  const corporateMatches = CORPORATE_SIGNALS.filter((term) =>
    transcriptLower.includes(term) ||
    metadata.videoDescription.toLowerCase().includes(term)
  );
  const hasCorporateSignal = corporateMatches.length > 0 || metadata.hasSponsor;

  // Calculate risk score
  let riskScore = 0;

  // Vague terms without nearby evidence (high risk)
  if (vagueCount > 0 && evidenceCount === 0) {
    riskScore += 40;
    issues.push(
      `Found ${vagueCount} vague sustainability term(s) without supporting evidence`
    );
  } else if (vagueCount > evidenceCount * 2) {
    riskScore += 30;
    issues.push(
      `More vague claims (${vagueCount}) than evidence indicators (${evidenceCount})`
    );
  } else if (vagueCount > 0 && evidenceCount > 0) {
    positives.push(
      `Found ${evidenceCount} evidence indicator(s) supporting claims`
    );
  }

  // Corporate channel making sustainability claims (potential conflict)
  if (metadata.channelSize > 1000000 && vagueCount > 0) {
    riskScore += 25;
    issues.push(
      'Large corporate channel making sustainability claims - verify independence'
    );
  }

  // Sponsored content
  if (hasCorporateSignal && vagueCount > 0) {
    riskScore += 20;
    issues.push('Sponsored content with sustainability claims - potential bias');
  } else if (hasCorporateSignal) {
    riskScore += 10;
  }

  // Missing specific metrics
  const hasNumbers = /\d+/.test(transcript);
  const hasPercentages = /%\s*reduction|\d+%\s*(carbon|emission|energy)/i.test(
    transcript
  );
  if (vagueCount > 0 && !hasNumbers && !hasPercentages) {
    riskScore += 15;
    issues.push('Vague claims without specific metrics or targets');
  } else if (hasNumbers || hasPercentages) {
    positives.push('Contains specific metrics and targets');
  }

  // Check for offsetting language (red flag)
  const offsettingTerms = ['offset', 'credit', 'compensate', 'balance'];
  const hasOffsetting = offsettingTerms.some((term) =>
    transcriptLower.includes(term)
  );
  if (hasOffsetting && evidenceCount < 2) {
    riskScore += 15;
    issues.push('Mentions carbon offsetting without detailed verification');
  }

  // Positive signals
  if (evidenceCount >= 3) {
    positives.push('Multiple evidence indicators found');
  }
  if (transcriptLower.includes('third-party') || transcriptLower.includes('audit')) {
    positives.push('References third-party verification or audits');
  }
  if (transcriptLower.includes('transparent') || transcriptLower.includes('disclosure')) {
    positives.push('Emphasizes transparency');
  }

  // Normalize score to 0-100
  riskScore = Math.min(100, Math.max(0, riskScore));

  // Determine level
  let level: 'LOW' | 'MODERATE' | 'HIGH';
  if (riskScore >= 60) {
    level = 'HIGH';
  } else if (riskScore >= 30) {
    level = 'MODERATE';
  } else {
    level = 'LOW';
  }

  // Default message if no issues found
  if (issues.length === 0 && riskScore < 30) {
    positives.push('No significant greenwashing indicators detected');
  }

  return {
    score: Math.round(riskScore),
    level,
    issues: issues.length > 0 ? issues : ['No major issues detected'],
    positives: positives.length > 0 ? positives : [],
  };
}

/**
 * Extract and verify sustainability claims from transcript
 */
export function extractClaims(transcript: string): ClaimVerification {
  if (!transcript || transcript.length < 100) {
    return {
      totalClaims: 0,
      verifiedClaims: 0,
      claims: [],
    };
  }

  const claims: Claim[] = [];
  const sentences = transcript
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);

  // Pattern to find claim sentences
  const claimPatterns = [
    /(?:we|our|they|the company|we've|we're|we'll)\s+(?:are|will|have|commit|pledge|aim|target|achieve|reduce|eliminate|offset)/i,
    /\d+\s*(?:percent|%|tonnes?|kg|emissions?|carbon|reduction|renewable)/i,
    /(?:carbon neutral|net zero|zero waste|100%\s*(?:renewable|sustainable|green))/i,
  ];

  for (const sentence of sentences) {
    const isClaim = claimPatterns.some((pattern) => pattern.test(sentence));

    if (isClaim) {
      const sentenceLower = sentence.toLowerCase();

      // Check if claim has evidence nearby
      const hasEvidence = EVIDENCE_WORDS.some((word) =>
        sentenceLower.includes(word)
      );

      // Check for specific numbers/metrics
      const hasMetrics = /\d+/.test(sentence);

      // Check for vague terms
      const hasVague = VAGUE_TERMS.some((term) =>
        sentenceLower.includes(term)
      );

      let verified = false;
      let issue: string | undefined;
      let evidence: string | undefined;

      if (hasEvidence) {
        verified = true;
        evidence = 'Contains evidence indicators';
      } else if (hasMetrics && !hasVague) {
        verified = true;
        evidence = 'Contains specific metrics';
      } else if (hasVague && !hasEvidence) {
        verified = false;
        issue = 'Vague claim without supporting evidence';
      } else {
        verified = false;
        issue = 'Unverified claim - needs evidence';
      }

      claims.push({
        text: sentence.slice(0, 150) + (sentence.length > 150 ? '...' : ''),
        verified,
        issue,
        evidence,
      });
    }
  }

  const verifiedClaims = claims.filter((c) => c.verified).length;

  return {
    totalClaims: claims.length,
    verifiedClaims,
    claims: claims.slice(0, 10), // Limit to 10 claims for UI
  };
}

/**
 * Determine source type and credibility
 */
export function analyzeSource(metadata: VideoMetadata): SourceCredibility {
  const channelSize = metadata.channelSize;
  const description = metadata.videoDescription.toLowerCase();
  const title = metadata.videoTitle.toLowerCase();

  let type: 'CORPORATE' | 'INDEPENDENT' | 'COMMUNITY' | 'UNKNOWN' = 'UNKNOWN';
  let credibilityLevel: 'LOW' | 'MODERATE' | 'HIGH' = 'MODERATE';
  const conflicts: string[] = [];
  let recommendation = '';

  // Determine source type
  if (channelSize > 1000000) {
    // Large channel - likely corporate or media
    if (
      CORPORATE_SIGNALS.some((term) => description.includes(term)) ||
      metadata.hasSponsor
    ) {
      type = 'CORPORATE';
    } else if (ACADEMIC_KEYWORDS.some((term) => description.includes(term))) {
      type = 'INDEPENDENT';
    } else {
      type = 'CORPORATE'; // Default large channels to corporate
    }
  } else if (channelSize > 100000) {
    // Medium channel
    if (ACADEMIC_KEYWORDS.some((term) => description.includes(term))) {
      type = 'INDEPENDENT';
    } else if (INDEPENDENT_KEYWORDS.some((term) => description.includes(term))) {
      type = 'INDEPENDENT';
    } else {
      type = 'UNKNOWN';
    }
  } else if (channelSize < 10000) {
    // Small channel - likely community
    type = 'COMMUNITY';
  } else {
    // Medium-small
    if (INDEPENDENT_KEYWORDS.some((term) => description.includes(term))) {
      type = 'INDEPENDENT';
    } else {
      type = 'COMMUNITY';
    }
  }

  // Assess credibility based on type and conflicts
  if (type === 'CORPORATE') {
    if (metadata.hasSponsor) {
      credibilityLevel = 'LOW';
      conflicts.push('Corporate channel with sponsored content');
    } else if (channelSize > 5000000) {
      credibilityLevel = 'MODERATE';
      conflicts.push('Very large corporate platform - verify claims independently');
    } else {
      credibilityLevel = 'MODERATE';
    }
    recommendation =
      'Verify sustainability claims independently. Corporate channels may have financial incentives.';
  } else if (type === 'INDEPENDENT') {
    if (ACADEMIC_KEYWORDS.some((term) => description.includes(term))) {
      credibilityLevel = 'HIGH';
      recommendation = 'Independent research-based source - high credibility';
    } else {
      credibilityLevel = 'MODERATE';
      recommendation = 'Independent analysis - verify specific claims';
    }
  } else if (type === 'COMMUNITY') {
    credibilityLevel = 'MODERATE';
    recommendation =
      'Community voice - authentic perspective but verify technical claims';
  } else {
    credibilityLevel = 'LOW';
    recommendation = 'Unknown source - verify all claims independently';
  }

  // Additional conflict checks
  if (type === 'CORPORATE' && channelSize > 1000000) {
    conflicts.push('Large platform reach increases responsibility for accuracy');
  }

  if (metadata.hasSponsor && type !== 'INDEPENDENT') {
    conflicts.push('Sponsored content may affect objectivity');
  }

  return {
    type,
    credibilityLevel,
    conflicts: conflicts.length > 0 ? conflicts : [],
    recommendation,
  };
}

/**
 * Main function to generate all sustainability insights
 */
export function generateSustainabilityInsights(
  transcript: string,
  metadata: VideoMetadata
): {
  greenwashingRisk: GreenwashingRisk;
  claimVerification: ClaimVerification;
  sourceCredibility: SourceCredibility;
} {
  return {
    greenwashingRisk: analyzeGreenwashing(transcript, metadata),
    claimVerification: extractClaims(transcript),
    sourceCredibility: analyzeSource(metadata),
  };
}

