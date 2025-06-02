const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: true, timeout: 10000 });
    const allResults = [];
    const listURL = "https://montreal.ca/lieux?mtl_content.lieux.installation.code=PISI";

    console.log(`parsing ${listURL} for list of pools`);
    const page = await browser.newPage();
    await page.goto(listURL, { waitUntil: 'networkidle2' });
    await page.waitForSelector('ul.list-group.list-group-teaser');

    let urls = await page.evaluate(() => {
        const urlItems = Array.from(document.getElementsByClassName("list-group-item-action d-block p-2"));
        if (!urlItems) { console.log("did not find any list items"); return {} }

        let retrievedURLS = [];

        urlItems.forEach(listHrefDiv => {
            retrievedURLS.push(listHrefDiv.href);
        });

        return retrievedURLS;
    });

    let currentPoolParsed = 0;
    let numPools = urls.length;
    for (const url of urls) {
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle0' });

        const borough = document.querySelector('.quick-links-label + ul li a')?.textContent.trim();

        const sessions = await page.evaluate((url) => {
            let parseSwimSchedulebPage = function (webDocument) {
                // Helper function to parse time strings like '18 h 30' or '14 h 00'
                function parseTime(timeStr) {
                    const match = timeStr.match(/(\d{1,2})\s*h\s*(\d{2})/);
                    if (match) {
                        let hours = parseInt(match[1], 10);
                        let minutes = parseInt(match[2], 10);
                        return { hours, minutes };
                    }
                    return null;
                }

                // Helper function to convert French day names to English
                const dayMap = {
                    'Lundi': 'Monday',
                    'Mardi': 'Tuesday',
                    'Mercredi': 'Wednesday',
                    'Jeudi': 'Thursday',
                    'Vendredi': 'Friday',
                    'Samedi': 'Saturday',
                    'Dimanche': 'Sunday'
                };

                // Select all headings that denote the audience category
                const headings = Array.from(webDocument.querySelectorAll('h3'));
                const sessions = [];

                headings.forEach(heading => {
                    const audience = heading.textContent.trim();
                    let nextElem = heading.nextElementSibling;

                    // Look for table class
                    while (nextElem && nextElem.className != "table-responsive ") {
                        nextElem = nextElem.nextElementSibling;
                    }

                    let tableChild;
                    if (nextElem) {

                        nextElem.childNodes.forEach(child => {
                            if (!tableChild && child.tagName == 'TABLE') {
                                tableChild = child;
                                return;
                            }
                        });
                    }

                    if (tableChild) {
                        const rows = tableChild.querySelectorAll('tbody tr');
                        rows.forEach(row => {
                            const cells = row.querySelectorAll('td');
                            if (cells.length >= 2) {
                                const dayFr = cells[0].textContent.trim();
                                const timeRange = cells[1].textContent.trim();
                                const [startStr, endStr] = timeRange.split('à').map(s => s.trim());

                                const startTime = parseTime(startStr);
                                const endTime = parseTime(endStr);

                                if (startTime && endTime) {
                                    sessions.push({
                                        audience,
                                        day: dayFr,
                                        start: `${String(startTime.hours).padStart(2, '0')}:${String(startTime.minutes).padStart(2, '0')}`,
                                        end: `${String(endTime.hours).padStart(2, '0')}:${String(endTime.minutes).padStart(2, '0')}`
                                    });
                                }
                            }
                        });
                    }
                });

                return sessions;
            };

            const allListTitleElements = Array.from(document.getElementsByClassName("list-item-icon-label"));
            const addressTitleEl = allListTitleElements.find(el => { return el.textContent.trim() == "Adresse"; });
            const addressEl = addressTitleEl ? addressTitleEl.nextElementSibling : null;
            const address = addressEl ? addressEl.textContent.replace(/\r?\n|\r/g, ' ') : "N/A";

            const cleanTitle = document.title.replace(' | Ville de Montréal', '').trim();

            const data = parseSwimSchedulebPage(document);
            return {
                url: location.href,
                title: cleanTitle,
                address: address,
                borough: borough,
                sessions: data
            };
        });

        allResults.push(sessions);
        console.log(`✅ Parsed: ${sessions.title} ${++currentPoolParsed}/${numPools}`);
        await page.close();
    }
    await browser.close();

    const fs = require('fs');
    fs.writeFileSync('swim_sessions_auto.json', JSON.stringify(allResults, null, 2));
    console.log('✅ Swim sessions saved to swim_sessions_auto.json');

})();