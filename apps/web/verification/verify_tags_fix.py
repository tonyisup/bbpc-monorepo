from playwright.sync_api import sync_playwright

def verify_tags_page():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Emulate a mobile device to test responsiveness
        context = browser.new_context(
            viewport={'width': 375, 'height': 812},
            user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1'
        )
        page = context.new_page()

        print("Navigating to /tags/christmas...")

        # Intercept the TRPC call to mock data
        def handle_route(route):
            response_json = {
                "result": {
                    "data": {
                        "json": {
                            "movies": [
                                {
                                    "id": 1,
                                    "title": "Die Hard",
                                    "poster_path": "https://image.tmdb.org/t/p/w500/yFihWxQcmqcaBR31XkW8n9joyh5.jpg",
                                    "overview": "Yippee Ki Yay",
                                    "release_date": "1988-07-15"
                                },
                                {
                                    "id": 2,
                                    "title": "Home Alone",
                                    "poster_path": "https://image.tmdb.org/t/p/w500/9wSbe4CwObACCQvaUVhWQyLR5Vz.jpg",
                                    "overview": "Kevin!",
                                    "release_date": "1990-11-16"
                                }
                            ],
                            "pagination": {
                                "page": 1,
                                "totalPages": 10
                            }
                        }
                    }
                }
            }
            route.fulfill(status=200, content_type="application/json", body=str(response_json).replace("'", '"'))

        # Set up interception for the specific TRPC endpoint
        page.route("**/api/trpc/tag.getMoviesForTag*", handle_route)

        page.goto("http://localhost:3000/tags/christmas")

        # Wait for the card to appear
        print("Waiting for card...")
        page.wait_for_selector(".absolute.top-0", timeout=10000)

        # Take a screenshot of the initial state
        print("Taking initial screenshot...")
        page.screenshot(path="verification/tags_initial.png")

        # Simulate a swipe or interaction if possible to check for crashes
        # Since we can't easily see animations in static screenshots, we ensure it renders at least
        print("Card found. Verification passed.")

        browser.close()

if __name__ == "__main__":
    verify_tags_page()
