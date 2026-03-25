# Automated Login Processing Bot

## ⚠️ Educational Disclaimer

**This project is created for educational and learning purposes only.** It is designed to demonstrate browser automation, anti-detection techniques, and error handling patterns. **This code will NOT be used in production environments** and is intended solely for:

- Learning browser automation with Playwright
- Understanding anti-detection mechanisms
- Studying error handling and retry patterns
- Educational exploration of web scraping techniques

## 📋 Project Overview

This project implements an automated browser bot that processes login queues using Multilogin profiles and Playwright browser automation. The bot is designed with robust error handling, automatic retry mechanisms, and anti-detection features.

## 🏗️ Architecture

### Core Components

1. **LoginProcessingBot** - Main orchestrator class
2. **MultiloginAPI** - Integration with Multilogin service
3. **CaptchaSolver** - hCaptcha solving service integration
4. **Error Handling System** - Comprehensive exception management
5. **Profile Management** - Automatic profile creation/recreation

### Key Features

- **Queue-based Processing**: Processes login credentials from a configurable queue
- **Anti-Detection**: 
  - Random delays between actions
  - Human-like behavior simulation
  - Profile recreation when bot detection occurs
- **Robust Error Handling**: 
  - Automatic retries with exponential backoff
  - Different retry strategies for different error types
  - Graceful failure handling
- **Captcha Solving**: Automatic hCaptcha resolution
- **Profile Management**: Dynamic Multilogin profile creation and management

## 🔧 Technical Stack

- **Node.js** - Runtime environment
- **Playwright** - Browser automation
- **Multilogin** - Anti-detection browser profiles
- **RuCaptcha** - Captcha solving service

## 🚀 Workflow

### Main Processing Loop

1. **Initialization**
   - Initialize Multilogin API connection
   - Setup captcha solving service
   - Configure logging and error handling

2. **Login Processing**
   - Fetch next login from queue
   - Find or create Multilogin profile
   - Launch browser with anti-detection profile
   - Navigate to target website

3. **Page Analysis**
   - Check for bot detection messages
   - Analyze iframe content for captcha
   - Detect login form availability

4. **Captcha Handling**
   - Extract captcha parameters
   - Submit to solving service
   - Inject solution back to page

5. **Login Execution**
   - Fill login credentials
   - Submit form
   - Verify login success

6. **Error Recovery**
   - Profile recreation on bot detection
   - Automatic retries with delays
   - Fallback mechanisms

## 🛡️ Anti-Detection Features

### Bot Detection Handling
- **Detection Triggers**: Monitors for "Pardon Our Interruption" messages
- **Profile Recreation**: Automatically recreates profiles when detected
- **Proxy Rotation**: Randomizes proxy parameters for new profiles
- **Behavioral Mimicking**: Random delays and human-like interactions

### Error Recovery Strategies
```javascript
Error Types & Retry Delays:
- ProfileException: 30 seconds
- BrowserStartException: 60 seconds  
- PageLoadException: 20 seconds
- CaptchaSolveException: 10 seconds
- LoginFailedException: 45 seconds
- BotDetectedException: 180 seconds (3 minutes)
```

## 📊 Statistics & Monitoring

The bot tracks comprehensive statistics:
- Successful/failed login attempts
- Error frequency by type
- Processing times and performance metrics
- Consecutive failure monitoring

## ⚙️ Configuration

### Timeouts
- Page Load: 60 seconds
- Captcha Solving: 120 seconds
- Browser Start: 30 seconds
- WebSocket Connection: 15 seconds

### Retry Logic
- Maximum retries per login: 3
- Maximum consecutive failures: 10
- Random delays between logins: 5-15 seconds

## 🔄 Error Handling Flow

```
Login Attempt → Error Occurs → Classify Error Type → Apply Retry Strategy
                                     ↓
Bot Detected → Stop Profile → Delete Profile → Create New → Retry
                                     ↓
Critical Error → Pause System → Reset Counters → Resume
```

## 📁 Project Structure

```
├── multilogin/
│   └── multilogin.js          # Multilogin API integration
├── captcha/
│   ├── solver.js              # Captcha solving service
│   └── exceptions.js          # Captcha-related exceptions
├── app.js                     # Main application entry point
└── README.md                  # This file
```

## 🚨 Important Notes

### Educational Purpose Only
This project is designed exclusively for educational purposes to demonstrate:
- Browser automation techniques
- Anti-detection methodologies
- Error handling patterns
- Retry mechanisms
- Integration with third-party services

### Not for Production Use
- **No commercial use intended**
- **No malicious activities supported**
- **Compliance with terms of service is user's responsibility**
- **Use only on websites you own or have explicit permission to test**

## 🎓 Learning Objectives

Students and developers can learn:
1. **Browser Automation**: Using Playwright for complex browser interactions
2. **Anti-Detection**: Implementing techniques to avoid detection systems
3. **Error Handling**: Building resilient systems with comprehensive error recovery
4. **API Integration**: Working with third-party services (Multilogin, Captcha solvers)
5. **Asynchronous Programming**: Managing complex async workflows
6. **Queue Processing**: Implementing robust queue-based processing systems

## 📝 License & Usage

This code is provided for educational purposes. Users are responsible for ensuring compliance with all applicable laws, regulations, and terms of service of any websites or services they interact with.

**Remember: Always respect robots.txt, terms of service, and rate limits when automating web interactions.**
- не пиши тесты для этого проекта