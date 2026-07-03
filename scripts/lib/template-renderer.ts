import path from 'path';
import { Eta } from 'eta';
import { escapeHtml } from './html-utils.ts';
import type { BuildIssue, BuildIssuesSummary } from './types.ts';

type TemplateGlobals = {
  faviconHtml?: string;
  buildIssues?: BuildIssue[];
  buildIssuesSummary?: BuildIssuesSummary;
  buildIssuesSummaryText?: string;
};

const root = path.resolve('.');
const templatesPath = path.join(root, 'src', 'templates');

const eta = new Eta({
  views: templatesPath,
  autoEscape: true,
  defaultExtension: '.eta',
});

let globals: TemplateGlobals = {};

function attrs(width: number | string, height: number | string, className = '') {
  return `width="${escapeHtml(String(width))}" height="${escapeHtml(String(height))}" class="${escapeHtml(
    `icon ${className}`.trim()
  )}"`;
}

function svgIcon(body: string, width = 16, height = 16, className = '', extra = '') {
  return `<svg ${attrs(width, height, className)} viewBox="0 0 24 24" aria-hidden="true" focusable="false"${extra}>${body}</svg>`;
}

export const icons = {
  iconEdit: (width = 16, height = 16, className = '') =>
    svgIcon(
      '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" />',
      width,
      height,
      className
    ),
  iconCopy: (width = 16, height = 16, className = '') =>
    svgIcon(
      '<rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />',
      width,
      height,
      `icon-copy ${className}`.trim()
    ),
  iconCheck: (width = 16, height = 16, className = '') =>
    svgIcon('<path d="M20 6 9 17l-5-5" />', width, height, `icon-check ${className}`.trim()),
  iconLanguage: (width = 16, height = 16, className = '') =>
    svgIcon(
      '<path d="m5 8 6 6" /><path d="m4 14 6-6 2-3" /><path d="M2 5h12" /><path d="M7 2h1" /><path d="m22 22-5-10-5 10" /><path d="M14 18h6" />',
      width,
      height,
      className
    ),
  iconCircleQuestionMark: (width = 16, height = 16, className = '') =>
    svgIcon(
      '<circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" />',
      width,
      height,
      className
    ),
  iconX: (width = 16, height = 16, className = '') =>
    svgIcon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', width, height, className),
  iconDownload: (width = 16, height = 16, className = '') =>
    svgIcon(
      '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
      width,
      height,
      className
    ),
  iconChevronDown: (width = 16, height = 16, className = '') =>
    svgIcon('<path d="m6 9 6 6 6-6" />', width, height, className),
  iconShare: (width = 16, height = 16, className = '') =>
    svgIcon(
      '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>',
      width,
      height,
      className
    ),
  iconImageDown: (width = 16, height = 16, className = '') =>
    svgIcon(
      '<path d="M10.3 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10l-3.1-3.1a2 2 0 0 0-2.814.014L6 21"/><path d="m14 19 3 3v-5.5"/><path d="m17 22 3-3"/><circle cx="9" cy="9" r="2"/>',
      width,
      height,
      className
    ),
  iconDebug: (width = 16, height = 16, className = '') =>
    `<span title="Debug" style="display: inline-flex; align-items: center; justify-content: center; cursor: help">${svgIcon(
      '<path d="M12 20v-9" /><path d="M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z" /><path d="M14.12 3.88 16 2" /><path d="M21 21a4 4 0 0 0-3.81-4" /><path d="M21 5a4 4 0 0 1-3.55 3.97" /><path d="M22 13h-4" /><path d="M3 21a4 4 0 0 1 3.81-4" /><path d="M3 5a4 4 0 0 0 3.55 3.97" /><path d="M6 13H2" /><path d="m8 2 1.88 1.88" /><path d="M9 7.13V6a3 3 0 1 1 6 0v1.13" />',
      width,
      height,
      className,
      ' color="red"'
    )}</span>`,
  iconGitHub: (width = 18, height = 18, className = '') =>
    `<svg ${attrs(width, height, `icon-fill ${className}`.trim())} viewBox="0 0 98 96" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z" /></svg>`,
  iconTwitter: (width = 18, height = 18, className = '') =>
    brandIcon(
      width,
      height,
      className,
      '0 0 640 640',
      '<path d="M453.2 112L523.8 112L369.6 288.2L551 528L409 528L297.7 382.6L170.5 528L99.8 528L264.7 339.5L90.8 112L236.4 112L336.9 244.9L453.2 112zM428.4 485.8L467.5 485.8L215.1 152L173.1 152L428.4 485.8z"/>'
    ),
  iconFacebook: (width = 18, height = 18, className = '') =>
    brandIcon(
      width,
      height,
      className,
      '0 0 640 640',
      '<path d="M240 363.3L240 576L356 576L356 363.3L442.5 363.3L460.5 265.5L356 265.5L356 230.9C356 179.2 376.3 159.4 428.7 159.4C445 159.4 458.1 159.8 465.7 160.6L465.7 71.9C451.4 68 416.4 64 396.2 64C289.3 64 240 114.5 240 223.4L240 265.5L174 265.5L174 363.3L240 363.3z"/>'
    ),
  iconReddit: (width = 18, height = 18, className = '') =>
    brandIcon(
      width,
      height,
      className,
      '0 0 640 640',
      '<path d="M437 202.6C411.8 202.6 390.7 185.1 385.1 161.6C354.5 165.9 330.9 192.3 330.9 224L330.9 224.2C378.3 226 421.5 239.3 455.8 260.5C468.4 250.8 484.2 245 501.3 245C542.6 245 576 278.4 576 319.7C576 349.5 558.6 375.2 533.3 387.2C530.9 474 436.3 543.8 320.1 543.8C203.9 543.8 109.5 474.1 107 387.4C81.6 375.5 64 349.7 64 319.7C64 278.4 97.4 245 138.7 245C155.9 245 171.7 250.8 184.4 260.6C218.4 239.5 261.2 226.2 308.1 224.2L308.1 223.9C308.1 179.6 341.8 143 384.9 138.4C389.8 114.2 411.2 96 437 96C466.4 96 490.3 119.9 490.3 149.3C490.3 178.7 466.4 202.6 437 202.6zM221.5 319.3C200.6 319.3 182.6 340.1 181.3 367.2C180 394.3 198.4 405.3 219.3 405.3C240.2 405.3 255.9 395.5 257.1 368.4C258.3 341.3 242.4 319.3 221.4 319.3L221.5 319.3zM459 367.1C457.8 340 439.8 319.2 418.8 319.2C397.8 319.2 381.9 341.2 383.1 368.3C384.3 395.4 400 405.2 420.9 405.2C441.8 405.2 460.2 394.2 458.9 367.1L459 367.1zM398.9 437.9C400.4 434.3 397.9 430.2 394 429.8C371 427.5 346.1 426.2 320.2 426.2C294.3 426.2 269.4 427.5 246.4 429.8C242.5 430.2 240 434.3 241.5 437.9C254.4 468.7 284.8 490.3 320.2 490.3C355.6 490.3 386 468.7 398.9 437.9z"/>'
    ),
  iconWeibo: (width = 18, height = 18, className = '') =>
    brandIcon(
      width,
      height,
      className,
      '0 0 640 640',
      '<path d="M471 241.6C478.6 217.6 457.6 194.8 433.6 199.9C411.6 204.7 404.8 171.8 426.5 167.1C476.6 156.2 518.8 204.2 503 251.9C496.2 273.1 464.2 262.7 471 241.6zM278.8 510.7C172.5 510.7 64 459.3 64 374.4C64 330.1 92 279 140.3 230.7C240 131 343.5 129.8 313.9 225C309.9 238.1 326.2 230.7 326.2 231C405.7 197.4 466.7 214.2 440.2 282.4C436.5 291.8 441.3 293.3 448.5 295.5C584.2 337.8 483.3 510.7 278.8 510.7zM422.5 364.4C417.1 308.7 344 270.4 259.1 278.7C174.3 287.3 110.3 339 115.7 394.7C121.1 450.4 194.2 488.7 279.1 480.4C363.9 471.8 427.9 420.1 422.5 364.4zM411.9 99.1C386 104.7 395.1 142.8 420.2 137.4C492.5 122.2 555 190.2 531.9 261.4C524.5 285.6 561 298.4 569.3 273.4C601.2 173.6 514.2 77.5 411.9 99.1zM333.4 410.1C316.3 448.9 266.6 470.1 224.3 456.4C183.5 443.3 166.3 403 184 366.7C201.7 331.3 247.1 311.3 287.4 321.6C329.4 332.4 350.5 371.8 333.4 410.1zM247.1 380.1C234.2 374.7 217.1 380.4 209.1 393C200.8 405.9 204.8 421 217.7 427C230.8 433 248.5 427.3 256.8 414.1C264.8 401 260.5 385.8 247.1 380.1zM279.7 366.7C274.6 365 268.3 367.3 265.4 372.1C262.5 377.2 264 382.7 269.1 385C274.2 387 280.8 384.7 283.7 379.6C286.5 374.4 284.8 368.7 279.7 366.7z"/>'
    ),
  iconEmail: (width = 18, height = 18, className = '') =>
    brandIcon(
      width,
      height,
      className,
      '0 0 640 640',
      '<path d="M320 128C214 128 128 214 128 320C128 426 214 512 320 512C337.7 512 352 526.3 352 544C352 561.7 337.7 576 320 576C178.6 576 64 461.4 64 320C64 178.6 178.6 64 320 64C461.4 64 576 178.6 576 320L576 352C576 405 533 448 480 448C450.7 448 424.4 434.8 406.8 414.1C384 435.1 353.5 448 320 448C249.3 448 192 390.7 192 320C192 249.3 249.3 192 320 192C347.9 192 373.7 200.9 394.7 216.1C400.4 211.1 407.8 208 416 208C433.7 208 448 222.3 448 240L448 352C448 369.7 462.3 384 480 384C497.7 384 512 369.7 512 352L512 320C512 214 426 128 320 128zM384 320C384 284.7 355.3 256 320 256C284.7 256 256 284.7 256 320C256 355.3 284.7 384 320 384C355.3 384 384 355.3 384 320z"/>'
    ),
};

function brandIcon(width: number, height: number, className: string, viewBox: string, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" ${attrs(width, height, `icon-fill ${className}`.trim())} viewBox="${viewBox}" aria-hidden="true">${body}</svg>`;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value ?? {})
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function renderSbBlock(
  content: unknown,
  editModuleId: unknown,
  editScriptId: unknown,
  scriptId: unknown,
  t: any,
  isDev: unknown
) {
  const scriptAttr = scriptId ? ` data-script-id="${escapeHtml(String(scriptId))}"` : '';
  const editLink = isDev
    ? `<a href="/__dev/editor/?module=${encodeURIComponent(String(editModuleId ?? ''))}&script=${encodeURIComponent(
        String(editScriptId ?? '')
      )}&tab=scripts" class="sb-action sb-edit" title="${escapeHtml(t.module.editScript)}" target="_blank">${icons.iconEdit()}</a>`
    : '';
  return `<div class="sb-block">
    <div class="sb-actions">
      ${editLink}
      <button class="sb-action sb-copy" type="button" aria-label="${escapeHtml(t.module.copyScript)}" title="${escapeHtml(
        t.module.copyScript
      )}">${icons.iconCopy()}${icons.iconCheck()}</button>
      <div class="sb-export-group">
        <div class="sb-export-options">
          <button class="sb-action sb-export-svg" type="button" aria-label="${escapeHtml(
            t.module.exportSVG
          )}" title="${escapeHtml(t.module.exportSVG)}">SVG</button>
          <button class="sb-action sb-export-png" type="button" aria-label="${escapeHtml(
            t.module.exportPNG
          )}" title="${escapeHtml(t.module.exportPNG)}">PNG</button>
        </div>
        <button class="sb-action sb-export" type="button" aria-label="${escapeHtml(
          t.module.exportImage
        )}" title="${escapeHtml(t.module.exportImage)}">${icons.iconImageDown()}</button>
      </div>
    </div>
    <pre class="scratchblocks"${scriptAttr}>${escapeHtml(String(content ?? ''))}</pre>
  </div>`;
}

function renderImportedDetails(imp: any, t: any, isDev: unknown, pageBase: string) {
  const fromTitle = imp.fromTitle ? `· ${escapeHtml(String(imp.fromTitle))}` : '';
  const fromIndex = imp.fromIndex ? `(#${escapeHtml(String(imp.fromIndex))})` : '';
  return `<details class="imported-script">
    <summary>
      ${escapeHtml(t.module.importedFrom)}
      <a href="${escapeHtml(String(pageBase))}/modules/${escapeHtml(String(imp.fromId))}/">${escapeHtml(
        String(imp.fromName)
      )}</a>
      ${fromTitle}
      ${fromIndex}
    </summary>
    ${renderSbBlock(imp.content, imp.fromId, imp.fromScriptId, '', t, isDev)}
  </details>`;
}

export function setTemplateGlobals(nextGlobals: TemplateGlobals) {
  globals = { ...globals, ...nextGlobals };
}

export function renderTemplate(template: string, context: Record<string, unknown>) {
  return eta.render(template, {
    ...globals,
    ...context,
    icons,
    helpers: {
      json: safeJson,
      renderSbBlock,
      renderImportedDetails,
    },
  });
}
