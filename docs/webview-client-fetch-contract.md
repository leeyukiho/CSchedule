# WebView Client Fetch Contract

## Feasibility

The WebView route is feasible for schools that require captcha, QR code, MFA, or other user interaction, but it must be treated as a structured-data bridge, not as arbitrary script injection.

In a normal browser, DevTools Console runs JavaScript inside the current page because the user controls that page context. A mini-program WebView does not expose that same capability to the host mini-program. The host can load a URL and receive messages from the page, but it cannot reliably inject and execute JavaScript inside an arbitrary third-party school page.

Use this route only when one of these is true:

- The loaded page is controlled by this project or by the school adapter, and can call the mini-program bridge after login.
- The school page already exposes structured data to JavaScript running in that page and the page can actively `postMessage` the result.
- The school provides frontend-accessible APIs after user login and a controlled bridge page can fetch them within the same valid session constraints.

Do not rely on pushing a parser script from a cloud function into an arbitrary third-party page. That is not a stable capability of mini-program WebView and will break on sandboxing, cross-origin, Cookie, CSP, or platform policy constraints.

## Data Flow

```text
mini-program opens WebView login URL
  -> user completes school login / captcha / MFA
  -> controlled page or school adapter emits structured JSON
  -> frontend compacts and deduplicates payload
  -> POST /account/:accountId/raw-data with responseMode=status_only
  -> backend writes CourseCache / FeatureCache
  -> backend returns syncStatus
  -> frontend closes WebView only when requiredTargets are cached
```

This reduces cloud function egress because the cloud function does not need to fetch and return bulky HTML/raw pages to the backend. The frontend uploads only normalized JSON fields needed for cache writes. It also reduces backend response bandwidth because `status_only` avoids echoing the full cache data back after upload.

## Message Format

The WebView page should send one payload or a batch:

```json
{
  "target": "course",
  "contentType": "json",
  "termId": "2025-2026-1",
  "payload": {
    "courses": [],
    "terms": [],
    "sectionTimes": []
  },
  "meta": {
    "parserVersion": "school-2026-06-17"
  }
}
```

Batch forms are also accepted:

```json
{
  "payloads": [
    { "target": "course", "contentType": "json", "payload": { "courses": [] } },
    { "target": "profile", "contentType": "json", "payload": { "data": {} } }
  ]
}
```

For cloud-worker direct-login schools such as WTBU, keep the current route:

```text
frontend/backend -> school-specific cloud function -> normalized cacheResults -> backend cache
```

For WebView schools, future expansion should usually change only:

- `connected-schools.json` school metadata and `authUrl`
- provider metadata / display config
- school-specific cloud function or controlled bridge page that emits the message contract above

The mini-program WebView page should remain generic.
