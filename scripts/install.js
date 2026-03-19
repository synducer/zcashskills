#!/usr/bin/env node

/**
 * Post-Install Script for ZCashSkills
 * 
 * Automatically detects platform and sets up the appropriate
 * native module for ZCash cryptographic operations.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// ANSI color codes for console output
const colors = {
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    blue: '\x1b[34m',
    reset: '\x1b[0m',
    bold: '\x1b[1m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
    log(`\n${colors.bold}=== ${title} ===${colors.reset}`);
}

async function main() {
    logSection('ZCash Skills Installation');
    
    log('🔧 Installing ZCash Skills native modules...', 'blue');
    
    // Detect platform and architecture
    const platform = os.platform();
    const arch = os.arch();
    const platformKey = `${platform}-${arch}`;
    
    log(`📋 Detected platform: ${platformKey}`, 'blue');
    
    // Define supported platforms
    const supportedPlatforms = [
        'linux-x64',     // Most servers and cloud environments
        'darwin-x64',    // Intel-based macOS systems
        'darwin-arm64',  // Apple Silicon Macs (M1/M2/M3)
        'win32-x64'      // Windows servers and development
    ];
    
    // Check platform support
    if (!supportedPlatforms.includes(platformKey)) {
        log(`⚠️  Platform ${platformKey} is not officially supported`, 'yellow');
        log('Supported platforms: ' + supportedPlatforms.join(', '), 'yellow');
        log('🔧 Attempting to build from source...', 'blue');
        return buildFromSource();
    }
    
    // Check if prebuilt binary exists
    const binaryPath = path.join(__dirname, '..', 'prebuilds', platformKey, 'zcash-native.node');
    
    log(`📍 Looking for binary: ${binaryPath}`, 'blue');
    
    if (fs.existsSync(binaryPath)) {
        log(`✅ Found prebuilt binary for ${platformKey}`, 'green');
        
        // Test loading the module
        try {
            require(binaryPath);
            log('✅ Native module loads successfully', 'green');
            log('🎉 ZCash Skills installation complete!', 'bold');
            
            logSection('Next Steps');
            log('Try the quick test:', 'blue');
            log('  node -e "const zcash = require(\'zcashskills\'); zcash.generateAddress().then(console.log);"', 'blue');
            log('\nOr check out the examples:', 'blue');
            log('  examples/openclaw/zcash-agent.js', 'blue');
            log('  examples/langchain/zcash-tools.js', 'blue');
            
        } catch (error) {
            log(`❌ Failed to load native module: ${error.message}`, 'red');
            log('🔧 Trying to rebuild from source...', 'yellow');
            return buildFromSource();
        }
    } else {
        log(`⚠️  No prebuilt binary found for ${platformKey}`, 'yellow');
        log('🔧 Building from source...', 'blue');
        return buildFromSource();
    }
}

function buildFromSource() {
    logSection('Building from Source');
    
    try {
        // Check for Rust installation
        log('🦀 Checking Rust installation...', 'blue');
        try {
            const rustVersion = execSync('rustc --version', { encoding: 'utf8', stdio: 'pipe' });
            log(`✅ Rust found: ${rustVersion.trim()}`, 'green');
        } catch {
            log('❌ Rust not found. Installing Rust...', 'yellow');
            log('📥 Please install Rust from https://rustup.rs/', 'yellow');
            log('💡 Or run: curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh', 'blue');
            throw new Error('Rust toolchain required for building from source');
        }
        
        // Check for Node.js native build tools
        log('🔧 Checking build dependencies...', 'blue');
        
        // Install Neon CLI if not present
        log('📥 Installing build dependencies...', 'blue');
        execSync('npm install @neon-rs/cli', { 
            stdio: 'inherit',
            cwd: path.join(__dirname, '..')
        });
        
        log('🔨 Building native module from source...', 'blue');
        log('⏳ This may take a few minutes...', 'yellow');
        
        // Build the native module
        execSync('npm run build', { 
            stdio: 'inherit',
            cwd: path.join(__dirname, '..')
        });
        
        log('✅ Build completed successfully!', 'green');
        
        // Test the built module
        log('🧪 Testing built module...', 'blue');
        const builtModulePath = path.join(__dirname, '..', 'target', 'release', 'zcash-native.node');
        
        if (fs.existsSync(builtModulePath)) {
            try {
                require(builtModulePath);
                log('✅ Built module loads successfully', 'green');
                log('🎉 ZCash Skills installation complete!', 'bold');
            } catch (error) {
                throw new Error(`Built module failed to load: ${error.message}`);
            }
        } else {
            throw new Error('Built module not found at expected path');
        }
        
    } catch (buildError) {
        logSection('Installation Failed');
        log('❌ Build failed:', 'red');
        log(buildError.message, 'red');
        
        log('\n🔍 Troubleshooting:', 'yellow');
        log('1. Ensure Rust is installed: https://rustup.rs/', 'yellow');
        log('2. Ensure Node.js version is compatible (>=16)', 'yellow');
        log('3. Check build tools availability:', 'yellow');
        
        if (os.platform() === 'linux') {
            log('   sudo apt-get install build-essential', 'blue');
        } else if (os.platform() === 'darwin') {
            log('   xcode-select --install', 'blue');
        } else if (os.platform() === 'win32') {
            log('   Install Visual Studio Build Tools', 'blue');
        }
        
        log('4. Create an issue: https://github.com/konradgnat/zcashskills/issues', 'yellow');
        
        process.exit(1);
    }
}

// Handle unhandled errors
process.on('uncaughtException', (error) => {
    log('\n💥 Installation failed with error:', 'red');
    log(error.message, 'red');
    log('\n🆘 Please create an issue with the error details:', 'yellow');
    log('https://github.com/konradgnat/zcashskills/issues', 'blue');
    process.exit(1);
});

// Run installation
main().catch((error) => {
    log('\n💥 Installation failed:', 'red');
    log(error.message, 'red');
    process.exit(1);
});