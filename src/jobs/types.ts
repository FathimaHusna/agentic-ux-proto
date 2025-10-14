export type IssueType = 'perf' | 'a11y' | 'seo' | 'flow';

export interface Metric {
  name: string;
  value: number;
  threshold?: number;
  unit?: string;
}

export interface Issue {
  id: string;
  type: IssueType;
  pageUrl?: string;
  title: string;
  evidence: string;
  ruleId?: string;
  wcag?: string;
  metric?: Metric;
  severity: number; // 1-5
  impact: number;   // 1-5
  effort: number;   // 1-5
  score: number;    // derived
  fixSteps: string[];
}

export interface AxeNode {
  target: string[];
}

export interface AxeViolation {
  id: string;
  impact?: 'minor' | 'moderate' | 'serious' | 'critical';
  description: string;
  helpUrl?: string;
  nodes: AxeNode[];
  wcag?: string;
}

export interface PageRun {
  url: string;
  links: string[];
  lhr?: any; // Lighthouse LHR JSON (subset)
  axe?: { violations: AxeViolation[] };
  snapshotPath?: string;
  screenshotPath?: string;
  meta?: {
    title?: string;
    description?: string;
    h1?: string;
  };
}

export interface JourneyStep {
  action: string;
  selector?: string;
  ok: boolean;
  t: number; // ms
  screenshotPath?: string;
  error?: string;
}

export interface Journey {
  name: string;
  steps: JourneyStep[];
  totalTime: number; // ms
  failedAt?: number; // step index
}

export interface JobOutputs {
  pages: PageRun[];
  issues: Issue[];
  journeys: Journey[];
  artifacts: {
    reportHtml?: string;
    reportHtmlPath?: string;
  };
  bench?: {
    targets: Array<{
      url: string;
      origin: string;
      page?: PageRun;
    }>;
  };
}

export interface EnginesOptions {
  crawler?: 'http';
  a11y?: 'pa11y';
}

export interface JobOptions {
  maxDepth: number;
  engines?: EnginesOptions;
  competitors?: string[];
}

export interface Job {
  id: string;
  url: string;
  options: JobOptions;
  status: 'queued' | 'running' | 'done' | 'error';
  progress: number; // 0-100
  stage?: string; // e.g., queued|crawl|perf|a11y|journeys|synthesis|done|error
  createdAt: string;
  updatedAt: string;
  summary?: string;
  outputs?: JobOutputs;
  error?: string;
}
