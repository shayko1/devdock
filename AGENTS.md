# DevDock Browser Tool

You have a `browser` command available in your PATH for controlling a real browser window.
Use this instead of `open` when you need to interact with or inspect web pages.

## Commands
```
browser open                        Open browser window
browser navigate <url>              Navigate to URL (aliases: goto, go)
browser screenshot                  Take screenshot & save to file (alias: snap)
browser click '<css-selector>'      Click an element
browser type '<selector>' <text>    Type text into input
browser evaluate '<js-code>'        Run JavaScript (aliases: eval, js)
browser text                        Get visible page text
browser content                     Get page HTML (alias: html)
browser url                         Get current URL and title
browser back / forward / reload     Navigation
browser close                       Close browser window
```

## Examples
```bash
browser navigate https://localhost:3000
browser screenshot
browser click '#submit-btn'
browser type '#email' hello@test.com
browser text
browser eval 'document.title'
```

## Important
- Always use `browser navigate <url>` instead of `open <url>` when you need to see page content
- Use `browser screenshot` to capture what's on screen — the image is saved to a file you can reference
- Use `browser text` to get visible page text for analysis
- The browser window persists across commands — you don't need to reopen it each time
