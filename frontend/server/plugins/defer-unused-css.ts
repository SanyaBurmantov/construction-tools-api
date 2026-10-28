/**
 * PageSpeed flagged `UiRating.css`, `UiEmpty.css`, `UiSkeleton.css` and
 * `UiBadge.css` as render-blocking on the home page, and none of them styles
 * anything the server rendered.
 *
 * Nuxt already inlines the styles of every component the SSR pass rendered
 * (`features.inlineStyles`) and drops their `<link>`. What is left is the CSS
 * of components a rendered chunk *imports* but did not draw: a `<ClientOnly>`
 * cart badge, a skeleton for client-side loading, a `v-if` empty state. Their
 * `<link rel="stylesheet">` still sits in `<head>` and holds the first paint.
 *
 * Here those links become `rel="preload" as="style"`: the file is fetched in
 * parallel without blocking, and Vite's dynamic-import helper attaches it as a
 * stylesheet when the chunk loads on the client (it adds the `<link>` itself
 * whenever no stylesheet with that href exists) — before hydration can render
 * the component that needs it. Without JS those components never render, so
 * nothing loses its styles.
 *
 * `entry.*.css` (the global `main.scss`) is left as a stylesheet: it styles
 * the page, and when it is inlined it has no link to rewrite anyway.
 */
const NUXT_CSS_LINK_RE = /<link rel="stylesheet" href="([^"]*\/_nuxt\/([^"/]+)\.css)"([^>]*)>/g

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:html', (html) => {
    html.head = html.head.map((chunk) =>
      chunk.replace(NUXT_CSS_LINK_RE, (tag, href: string, name: string, rest: string) =>
        name.startsWith('entry.') ? tag : `<link rel="preload" as="style" href="${href}"${rest}>`,
      ),
    )
  })
})
