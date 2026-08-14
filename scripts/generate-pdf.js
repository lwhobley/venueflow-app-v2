const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const artifactDir = 'C:\\Users\\lwhob\\.gemini\\antigravity-ide\\brain\\7eafcf47-97c5-4af7-a667-401094bb4190';
const workspaceDir = 'C:\\Users\\lwhob\\OneDrive\\Downloads\\a0-project-iteration-2';

const img1Path = path.join(artifactDir, 'venueflow_3d_stadium_twin_1786675114205.jpg');
const img2Path = path.join(artifactDir, 'venueflow_command_center_1786675195037.jpg');
const img3Path = path.join(artifactDir, 'venueflow_pos_union_compliance_1786675233830.jpg');

const img1Base64 = fs.existsSync(img1Path) ? `data:image/jpeg;base64,${fs.readFileSync(img1Path).toString('base64')}` : '';
const img2Base64 = fs.existsSync(img2Path) ? `data:image/jpeg;base64,${fs.readFileSync(img2Path).toString('base64')}` : '';
const img3Base64 = fs.existsSync(img3Path) ? `data:image/jpeg;base64,${fs.readFileSync(img3Path).toString('base64')}` : '';

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Venue Wrangler · Product Overview & Enterprise Valuation Memorandum</title>
<style>
  @page {
    size: A4 portrait;
    margin: 16mm 14mm 16mm 14mm;
  }
  * {
    box-sizing: border-box;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1D2420;
    line-height: 1.45;
    background: #FFFFFF;
    margin: 0;
    padding: 0;
    font-size: 10.5pt;
  }
  .header {
    border-bottom: 3px solid #074426;
    padding-bottom: 12px;
    margin-bottom: 16px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .brand-title {
    font-size: 24pt;
    font-weight: 900;
    color: #074426;
    letter-spacing: -0.5px;
    margin: 0;
  }
  .brand-tagline {
    font-size: 11pt;
    font-weight: 700;
    color: #8A5D23;
    margin-top: 2px;
  }
  .doc-meta {
    text-align: right;
    font-size: 8.5pt;
    color: #556058;
    font-weight: 600;
  }
  .badge {
    display: inline-block;
    background: #EEF5F0;
    color: #074426;
    font-weight: 800;
    font-size: 8pt;
    padding: 3px 8px;
    border-radius: 4px;
    border: 1px solid #B6D6BE;
    text-transform: uppercase;
    margin-bottom: 4px;
  }
  h2 {
    color: #074426;
    font-size: 13pt;
    font-weight: 800;
    border-left: 4px solid #074426;
    padding-left: 8px;
    margin-top: 18px;
    margin-bottom: 8px;
  }
  h3 {
    color: #17643B;
    font-size: 11pt;
    font-weight: 700;
    margin-top: 10px;
    margin-bottom: 4px;
  }
  p {
    margin: 4px 0 8px 0;
  }
  .executive-summary {
    background: #F6FAF7;
    border: 1.5px solid #17643B;
    border-radius: 6px;
    padding: 12px 14px;
    margin-bottom: 14px;
  }
  .executive-summary p {
    margin: 0;
    font-size: 10pt;
    color: #1D2420;
    font-weight: 500;
  }
  .image-card {
    background: #FFFFFF;
    border: 1px solid #D9E2DC;
    border-radius: 6px;
    padding: 8px;
    margin: 10px 0;
    text-align: center;
    page-break-inside: avoid;
  }
  .image-card img {
    width: 100%;
    max-height: 280px;
    object-fit: cover;
    border-radius: 4px;
    display: block;
  }
  .image-caption {
    font-size: 8.5pt;
    font-weight: 700;
    color: #074426;
    margin-top: 6px;
  }
  .grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin: 10px 0;
  }
  .kpi-card {
    background: #F8FAF9;
    border: 1px solid #D9E2DC;
    border-radius: 6px;
    padding: 10px;
    page-break-inside: avoid;
  }
  .kpi-val {
    font-size: 16pt;
    font-weight: 900;
    color: #074426;
  }
  .kpi-label {
    font-size: 8.5pt;
    font-weight: 700;
    color: #1D2420;
    text-transform: uppercase;
  }
  .kpi-sub {
    font-size: 8pt;
    color: #556058;
    margin-top: 2px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 10px 0 14px 0;
    font-size: 9pt;
    page-break-inside: avoid;
  }
  th {
    background: #074426;
    color: #FFFFFF;
    font-weight: 700;
    text-align: left;
    padding: 6px 8px;
    border: 1px solid #074426;
  }
  td {
    padding: 6px 8px;
    border: 1px solid #D9E2DC;
  }
  tr:nth-child(even) td {
    background: #F8FAF9;
  }
  .page-break {
    page-break-before: always;
  }
  .feature-list {
    margin: 4px 0;
    padding-left: 16px;
  }
  .feature-list li {
    margin-bottom: 3px;
    font-size: 9.5pt;
  }
  .footer-note {
    font-size: 8pt;
    color: #77807A;
    border-top: 1px solid #D9E2DC;
    padding-top: 8px;
    margin-top: 18px;
    text-align: center;
  }
</style>
</head>
<body>

  <!-- PAGE 1: TITLE, EXECUTIVE SUMMARY & 3D STADIUM TWIN -->
  <div class="header">
    <div>
      <div class="badge">Enterprise Product Overview &amp; Valuation Memo</div>
      <div class="brand-title">VENUE WRANGLER</div>
      <div class="brand-tagline">The Next-Generation Operating System for Live Sports &amp; Entertainment Venues</div>
    </div>
    <div class="doc-meta">
      <div>CONFIDENTIAL BRIEFING</div>
      <div>White-Label &amp; Strategic Licensing</div>
      <div>Date: August 2026</div>
    </div>
  </div>

  <div class="executive-summary">
    <p>
      <strong>Venue Wrangler</strong> is an enterprise stadium operating system and spatial digital twin engineered for NFL/MLB/NBA arenas, convention centers, and major concessionaires (Aramark, Levy, Delaware North, Legends). Uniting <strong>Ticketmaster-grade 3D venue mapping</strong>, <strong>real-time POS data aggregation</strong>, <strong>automated game-day operations command</strong>, and <strong>statutory union labor compliance (UNITE HERE / IATSE / SEIU)</strong>, Venue Wrangler replaces fragmented legacy silos with a single high-margin intelligence platform.
    </p>
  </div>

  <div class="grid-2">
    <div class="kpi-card">
      <div class="kpi-val">$52.5B TAM</div>
      <div class="kpi-label">Global Venue &amp; Sports Tech Market</div>
      <div class="kpi-sub">Converging Stadium SaaS, POS rails, and labor compliance.</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-val">$95K – $385K</div>
      <div class="kpi-label">Average Annual Contract Value (ACV)</div>
      <div class="kpi-sub">82%+ gross software margin per stadium property.</div>
    </div>
  </div>

  <h2>1. Ticketmaster-Style 3D Spatial Digital Twin</h2>
  <p>
    Venue Wrangler provides full 3D isometric bowl perspective and 2D floorplan visualization across all physical layers of a stadium:
  </p>
  <ul class="feature-list">
    <li><strong>Level 0 Field &amp; Sidelines</strong>: Real-time service areas on Home and Visiting Sidelines, player hydration benches, and North/South Endzone mobile runner depots.</li>
    <li><strong>Level 0 Athlete &amp; Performer Compound</strong>: Home/Visiting team locker rooms with nutrition kitchens, Halftime Headliner green room dressing suites, and league official rooms.</li>
    <li><strong>Level 100 Concourse &amp; VIP Bunkers</strong>: 8 distributed high-velocity concession hubs and 2 luxury sub-field bunker vaults (Chef carving stations &amp; bourbon cellars).</li>
    <li><strong>Level 200 Club &amp; 300 Luxury Suites</strong>: Owners skyboxes, panoramic 50-yardline taprooms, and digital BEO pre-order tracking.</li>
  </ul>

  <div class="image-card">
    <img src="${img1Base64}" alt="Venue Wrangler 3D Stadium Twin">
    <div class="image-caption">Figure 1: Venue Wrangler 3D Spatial Digital Twin with Interactive Concourse, Bunkers, and Locker Rooms</div>
  </div>

  <!-- PAGE 2: COMMAND CENTER, POS AGGREGATOR & UNION COMPLIANCE -->
  <div class="page-break"></div>

  <div class="header">
    <div>
      <div class="brand-title" style="font-size: 18pt;">VENUE WRANGLER</div>
      <div class="brand-tagline">Core Operational Modules &amp; Compliance Architecture</div>
    </div>
    <div class="doc-meta">
      <div>Module Deep Dive</div>
      <div>Confidential</div>
    </div>
  </div>

  <h2>2. Master Operations Command Center</h2>
  <p>
    An automated game-day cockpit offering a composite <strong>0–100% Venue Readiness Score</strong>, active action blocker queues, run-of-show milestone timelines, vendor gate check-ins, and one-tap post-event financial closeout (attendance, POS sales, and labor percentages).
  </p>

  <div class="image-card">
    <img src="${img2Base64}" alt="Venue Wrangler Executive Command Center">
    <div class="image-caption">Figure 2: Master Operations Command Center with 98% Readiness Scoring and Action Blockers Queue</div>
  </div>

  <h2>3. Universal POS Aggregator &amp; Union Labor Compliance Engine</h2>
  <div class="grid-2">
    <div>
      <h3>Universal POS Stream</h3>
      <p style="font-size: 9pt;">
        Ingests real-time streams across <strong>Toast, Clover, Square, Micros Simphony, Revel, Shift4, and Lightspeed</strong>. Eliminates expensive hardware replacements while delivering unified revenue telemetry and stand-sheet reconciliation.
      </p>
    </div>
    <div>
      <h3>Automated CBA Rules Engine</h3>
      <p style="font-size: 9pt;">
        Enforces <strong>UNITE HERE, IATSE, and SEIU</strong> collective bargaining rules: daily/weekly overtime, meal/rest break penalty automation, split-shift premiums, and geofenced badge verification to prevent union grievances.
      </p>
    </div>
  </div>

  <div class="image-card">
    <img src="${img3Base64}" alt="Venue Wrangler POS & Union Compliance">
    <div class="image-caption">Figure 3: Universal POS Revenue Aggregator &amp; Multi-Venue Union Compliance Telemetry Dashboard</div>
  </div>

  <!-- PAGE 3: VALUATION SCENARIOS & M&A BENCHMARKS -->
  <div class="page-break"></div>

  <div class="header">
    <div>
      <div class="brand-title" style="font-size: 18pt;">VENUE WRANGLER</div>
      <div class="brand-tagline">Enterprise Valuation Framework &amp; Strategic Benchmarks</div>
    </div>
    <div class="doc-meta">
      <div>Valuation Analysis</div>
      <div>Confidential</div>
    </div>
  </div>

  <h2>4. Comparable Transactions &amp; Market Multiples</h2>
  <table>
    <thead>
      <tr>
        <th>Company / Deal</th>
        <th>Acquirer / Valuer</th>
        <th>Valuation / Deal Size</th>
        <th>Valuation Multiple Benchmark</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>VenueNext</strong></td>
        <td>Shift4 (2021)</td>
        <td><strong>$72 Million</strong></td>
        <td>~10x – 12x ARR (Stadium digital infrastructure)</td>
      </tr>
      <tr>
        <td><strong>Appetize</strong></td>
        <td>SpotOn (2021)</td>
        <td><strong>$415 Million</strong></td>
        <td>~9x – 11x ARR (Sports &amp; entertainment F&amp;B)</td>
      </tr>
      <tr>
        <td><strong>SevenRooms</strong></td>
        <td>Strategic Growth</td>
        <td><strong>$500M+ Valuation</strong></td>
        <td>~12x – 16x ARR (Guest hospitality &amp; CRM)</td>
      </tr>
      <tr>
        <td><strong>Toast (NYSE: TOST)</strong></td>
        <td>Public Market</td>
        <td><strong>~$15 Billion</strong></td>
        <td>~3.5x – 4.5x Gross Revenue / 8x Gross Profit</td>
      </tr>
    </tbody>
  </table>

  <h2>5. Valuation Methodology &amp; Financial Projections</h2>

  <h3>Scenario A: Strategic IP &amp; Asset Replacement (Current Pre-Scale)</h3>
  <p style="font-size: 9.5pt;">
    <strong>Asset Valuation: $2.5M – $5.0M</strong><br>
    Based on replacement cost and intellectual property of the turnkey NestJS/Expo platform, 3D stadium twin engine, universal POS schema, and union compliance IP.
  </p>

  <h3>Scenario B: Vertical SaaS ARR Multiple Valuation (Commercial Rollout)</h3>
  <table>
    <thead>
      <tr>
        <th>Deployment Tier</th>
        <th>Annual ARR</th>
        <th>Conservative (8x)</th>
        <th>Base Case (11x)</th>
        <th>Bull Case (14x)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>10 Stadium Venues</strong></td>
        <td>$1.20M</td>
        <td>$9.6 Million</td>
        <td><strong>$13.2 Million</strong></td>
        <td>$16.8 Million</td>
      </tr>
      <tr>
        <td><strong>25 Stadium Venues</strong></td>
        <td>$3.00M</td>
        <td>$24.0 Million</td>
        <td><strong>$33.0 Million</strong></td>
        <td>$42.0 Million</td>
      </tr>
      <tr>
        <td><strong>50 Venues (Concessionaire)</strong></td>
        <td>$6.50M</td>
        <td>$52.0 Million</td>
        <td><strong>$71.5 Million</strong></td>
        <td>$91.0 Million</td>
      </tr>
    </tbody>
  </table>

  <h3>Scenario C: Strategic M&amp;A Exit</h3>
  <p style="font-size: 9.5pt;">
    <strong>Target Exit Range: $35M – $85M+</strong> upon scaling to $3M–$6M ARR, representing an acquisition target for <strong>Shift4, Toast, Oracle Hospitality, Aramark, Levy, or Legends</strong>.
  </p>

  <h2>6. Technology Stack &amp; White-Label Readiness</h2>
  <p style="font-size: 9pt;">
    Built for enterprise scale with <strong>Expo Router, React Native for Web, NestJS API, PostgreSQL (Prisma), Supabase Auth, Redis, RabbitMQ, and Cloudflare Pages edge hosting</strong>. Supports 100% white-label custom domain branding, multi-tenant isolation, and granular RBAC.
  </p>

  <div class="footer-note">
    VENUE WRANGLER · ENTERPRISE VALUATION &amp; PRODUCT MEMORANDUM · CONFIDENTIAL
  </div>

</body>
</html>`;

const tempHtmlPath = path.join(artifactDir, 'venue_wrangler_presentation.html');
const outputPdfPath = path.join(workspaceDir, 'Venue_Wrangler_Valuation_and_Overview.pdf');
const outputArtifactPdfPath = path.join(artifactDir, 'Venue_Wrangler_Valuation_and_Overview.pdf');

fs.writeFileSync(tempHtmlPath, htmlContent, 'utf8');

// Render PDF with headless browser
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browserExe = fs.existsSync(edgePath) ? edgePath : chromePath;

const cmd = `"${browserExe}" --headless --disable-gpu --run-all-compositor-stages-before-draw --print-to-pdf="${outputPdfPath}" --no-pdf-header-footer "${tempHtmlPath}"`;
console.log('Generating PDF via browser engine...');
execSync(cmd, { stdio: 'inherit' });

// Also copy to artifact directory
fs.copyFileSync(outputPdfPath, outputArtifactPdfPath);
console.log('PDF generated successfully at:', outputPdfPath);
