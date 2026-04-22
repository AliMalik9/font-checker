const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/analyze', async (req, res) => {
    const startUrl = req.query.url;

    if (!startUrl) {
        return res.status(400).json({ error: 'URL is required' });
    }

    const formattedUrl = startUrl.startsWith('http') ? startUrl : `https://${startUrl}`;
    
    let targetDomain;
    try {
        targetDomain = new URL(formattedUrl).hostname;
    } catch (e) {
        return res.status(400).json({ error: 'Invalid URL format.' });
    }

    const visitedUrls = new Set();
    const urlsToVisit = [formattedUrl];
    const siteTypographyData = [];
    
    // SAFETY LIMIT: Set to 5 to prevent infinite crawling. 
    // You can increase this, but it will take longer to load.
    const MAX_PAGES_TO_CRAWL = 5; 

    try {
        const browser = await puppeteer.launch({ headless: "new" });

        while (urlsToVisit.length > 0 && visitedUrls.size < MAX_PAGES_TO_CRAWL) {
            const currentUrl = urlsToVisit.shift();
            
            // Clean URL: Remove hash anchors to avoid duplicate visits to the same page
            const cleanUrl = currentUrl.split('#')[0];
            
            if (visitedUrls.has(cleanUrl)) continue;
            visitedUrls.add(cleanUrl);
            
            console.log(`Crawling (${visitedUrls.size}/${MAX_PAGES_TO_CRAWL}): ${cleanUrl}`);

            const page = await browser.newPage();
            
            try {
                // Wait for DOM to load (ignoring images/videos) for maximum speed
                await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

                // 1. Extract Fonts for the current page
                const pageFonts = await page.evaluate(() => {
                    const elementsToInspect = ['h1', 'h2', 'h3', 'p', 'a', 'span', 'button'];
                    const results = [];

                    elementsToInspect.forEach(tag => {
                        const element = document.querySelector(tag);
                        if (element) {
                            const styles = window.getComputedStyle(element);
                            
                            const rgb2hex = (rgb) => {
                                const match = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
                                if (!match) return rgb;
                                return "#" + ("0" + parseInt(match[1], 10).toString(16)).slice(-2) +
                                             ("0" + parseInt(match[2], 10).toString(16)).slice(-2) +
                                             ("0" + parseInt(match[3], 10).toString(16)).slice(-2);
                            };

                            // Only add if font size is valid to avoid hidden/empty elements
                            if (styles.fontSize !== '0px') {
                                results.push({
                                    label: `${tag.toUpperCase()} Element`,
                                    family: styles.fontFamily.replace(/['"]/g, ''),
                                    size: styles.fontSize,
                                    weight: styles.fontWeight,
                                    lineHeight: styles.lineHeight,
                                    color: rgb2hex(styles.color)
                                });
                            }
                        }
                    });
                    return results;
                });

                if (pageFonts.length > 0) {
                    siteTypographyData.push({ page: cleanUrl, fonts: pageFonts });
                }

                // 2. Extract internal links to continue crawling
                const newLinks = await page.evaluate(() => {
                    return Array.from(document.querySelectorAll('a'))
                        .map(a => a.href)
                        .filter(href => href.startsWith('http'));
                });

                // 3. Filter links (must be same domain, not visited, not already in queue)
                for (let href of newLinks) {
                    try {
                        const urlObj = new URL(href);
                        const cleanHref = href.split('#')[0];
                        if (urlObj.hostname === targetDomain && 
                            !visitedUrls.has(cleanHref) && 
                            !urlsToVisit.includes(cleanHref)) {
                            urlsToVisit.push(cleanHref);
                        }
                    } catch (e) {
                        // Ignore malformed URLs silently
                    }
                }
            } catch (pageError) {
                console.error(`Skipping ${cleanUrl} due to error:`, pageError.message);
            } finally {
                await page.close();
            }
        }

        await browser.close();
        res.json({ pages: siteTypographyData });

    } catch (error) {
        console.error("Master Error:", error);
        res.status(500).json({ error: 'Failed to crawl the website. The site might be blocking bots.' });
    }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));