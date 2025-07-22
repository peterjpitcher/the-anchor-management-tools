#!/bin/bash

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting comprehensive screenshot capture...${NC}"
echo ""

# Check if TEST_EMAIL and TEST_PASSWORD are set
if [ -z "$TEST_EMAIL" ] || [ -z "$TEST_PASSWORD" ]; then
    echo -e "${RED}❌ Error: TEST_EMAIL and TEST_PASSWORD environment variables must be set${NC}"
    echo -e "${YELLOW}📝 Example:${NC}"
    echo "   export TEST_EMAIL='peter.pitcher@outlook.com'"
    echo "   export TEST_PASSWORD='Pitcher1458955'"
    echo "   ./scripts/capture-all-screenshots.sh"
    exit 1
fi

# Check if puppeteer is installed
if ! npm list puppeteer >/dev/null 2>&1; then
    echo -e "${YELLOW}📦 Installing puppeteer...${NC}"
    npm install puppeteer
fi

# Step 1: Capture production screenshots
echo -e "${GREEN}📸 Step 1: Capturing production screenshots...${NC}"
tsx scripts/capture-production-screenshots.ts
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to capture production screenshots${NC}"
    exit 1
fi
echo ""

# Step 2: Check if dev server is running
echo -e "${GREEN}🔍 Step 2: Checking development server...${NC}"
if ! curl -s http://localhost:3000 > /dev/null; then
    echo -e "${YELLOW}⚠️  Development server not running${NC}"
    echo -e "${YELLOW}   Please run 'npm run dev' in another terminal, then run this script again${NC}"
    echo -e "${BLUE}   Skipping development screenshots for now...${NC}"
else
    echo -e "${GREEN}📸 Capturing development screenshots...${NC}"
    tsx scripts/capture-dev-screenshots.ts
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Failed to capture development screenshots${NC}"
    fi
fi
echo ""

# Step 3: Generate comparison
echo -e "${GREEN}🔄 Step 3: Generating comparison page...${NC}"
tsx scripts/compare-screenshots.ts
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to generate comparison${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ Screenshot capture complete!${NC}"
echo ""
echo -e "${BLUE}📁 Screenshot locations:${NC}"
echo "   Production: screenshots/production/"
echo "   Development: screenshots/development/"
echo "   Comparison: screenshots/comparison/index.html"
echo ""
echo -e "${YELLOW}💡 Next steps:${NC}"
echo "   1. Open screenshots/comparison/index.html in your browser"
echo "   2. Use the comparison tools to identify UI differences"
echo "   3. Update the development UI to match production styling"

# Try to open the comparison page automatically
if command -v open >/dev/null 2>&1; then
    echo ""
    echo -e "${BLUE}🌐 Opening comparison page...${NC}"
    open screenshots/comparison/index.html
elif command -v xdg-open >/dev/null 2>&1; then
    echo ""
    echo -e "${BLUE}🌐 Opening comparison page...${NC}"
    xdg-open screenshots/comparison/index.html
fi