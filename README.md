# WhatsApp Linker & Analyzer

A Node.js application that links WhatsApp Web and analyzes message data, providing comprehensive insights into chat patterns, contacts, and communication statistics.

## What It Does

- **Links WhatsApp Web** using phone number and pairing codes
- **Analyzes message data** including chats, groups, contacts, and message patterns
- **Generates reports** in both JSON and human-readable text formats
- **Web interface** for easy phone number input and real-time status updates

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Build & Run
```bash
npm run build
npm run dev
```

### 3. Use the Web App
1. Open http://localhost:3000 in your browser
2. Enter your phone number with country code (e.g., `+1234567890`)
3. Click "Link WhatsApp"

### 4. Complete WhatsApp Linking
1. **Watch terminal** for the 6-digit pairing code
2. **Open WhatsApp** on your phone (MAKE SURE APP IS CLOSED BEFORE PAIRING)
3. **Go to Settings > Linked Devices**
4. **Tap "Link Device"**
5. **Tap "Link with phone number instead"**
5. **Enter the code** from terminal
6. **Wait for linking** to complete (analysis runs automatically)

### 5. Get Results
Analysis results are saved to the `data/` folder:
- `whatsapp-analysis-[phone]-[timestamp].json` - Raw data
- `whatsapp-analysis-[phone]-[timestamp].txt` - Human-readable report

## Output Includes

- **Profile info** (name, about, business status)
- **Message statistics** (total messages, chats, groups, contacts)
- **Message types** (text, media, calls, etc.)
- **Top contacts** and most active chats
- **Group analysis** (most active groups, group sizes)
- **Communication patterns** (message frequency, time analysis)

## Useful Features

- **Real-time status** updates in web interface
- **Automatic analysis** after successful linking
- **Comprehensive reporting** with detailed statistics
- **Cross-platform** compatibility (Windows, macOS, Linux)

## Requirements

- Node.js 16+
- WhatsApp account
- Phone with WhatsApp installed

## Potential Failures
1. Hanging on initialize WhatsApp Client --> delete .wwebjs_cache folder, delete dist folder, run npm run build and try again
2. WhatsApp does not accept code --> keep trying the code. If this fails, close the WhatsApp app, and try process again.

