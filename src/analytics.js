import { config } from "./config.js";

function cleanText(value) {
  return String(value || "").trim();
}

export function googleAnalyticsMeasurementId() {
  return cleanText(config.googleAnalyticsMeasurementId);
}

export function googleAnalyticsHeadHtml() {
  const measurementId = googleAnalyticsMeasurementId();
  if (!measurementId) {
    return "";
  }

  return [
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}"></script>`,
    '<script defer src="/analytics.js"></script>'
  ].join("\n    ");
}

export function injectGoogleAnalyticsHead(html = "") {
  const source = String(html || "");
  const headHtml = googleAnalyticsHeadHtml();
  if (!headHtml) {
    return source;
  }

  if (
    source.includes("googletagmanager.com/gtag/js") ||
    source.includes('src="/analytics.js"')
  ) {
    return source;
  }

  return source.replace("</head>", `    ${headHtml}\n  </head>`);
}

export function googleAnalyticsBootstrapJs() {
  const measurementId = googleAnalyticsMeasurementId();
  if (!measurementId) {
    return "window.dataLayer = window.dataLayer || [];\n";
  }

  return [
    "window.dataLayer = window.dataLayer || [];",
    "window.gtag = window.gtag || function gtag(){window.dataLayer.push(arguments);};",
    'window.gtag("js", new Date());',
    `window.gtag("config", ${JSON.stringify(measurementId)});`,
    ""
  ].join("\n");
}
