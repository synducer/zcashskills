/**
 * Native Module Loader
 * 
 * Automatically detects platform and loads the appropriate
 * pre-compiled Rust binary for ZCash cryptographic operations.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

/**
 * Load the appropriate native module for the current platform
 * @returns {Object} Native module with Rust functions
 */
function loadNativeModule() {
    // Detect platform and architecture
    const platform = os.platform();  // 'linux', 'darwin', 'win32'
    const arch = os.arch();          // 'x64', 'arm64'
    
    // Create platform key for binary selection
    const platformKey = `${platform}-${arch}`;
    
    console.log(`🔍 ZCashSkills: Detected platform ${platformKey}`);
    
    // Define supported platforms
    const supportedPlatforms = [
        'linux-x64',     // Most servers and cloud environments
        'darwin-x64',    // Intel-based macOS systems  
        'darwin-arm64',  // Apple Silicon Macs (M1/M2/M3)
        'win32-x64'      // Windows servers and development
    ];
    
    // Check platform support
    if (!supportedPlatforms.includes(platformKey)) {
        throw new Error(
            `❌ Unsupported platform: ${platformKey}\n` +
            `Supported platforms: ${supportedPlatforms.join(', ')}\n` +
            `Please create an issue: https://github.com/konradgnat/zcashskills/issues`
        );
    }
    
    // Construct path to prebuilt binary
    const binaryPath = path.join(
        __dirname,
        '..',
        'prebuilds',
        platformKey,
        'zcash-native.node'
    );
    
    console.log(`📍 ZCashSkills: Loading binary from ${binaryPath}`);
    
    // Check if prebuilt binary exists
    if (!fs.existsSync(binaryPath)) {
        console.warn(`⚠️  Prebuilt binary not found: ${binaryPath}`);
        console.log('🔧 Attempting to build from source...');
        
        // Try building from source as fallback
        return buildFromSource();
    }
    
    try {
        // Load the native module
        const nativeModule = require(binaryPath);
        
        // Validate module exports
        if (!nativeModule.generateShieldedAddress) {
            throw new Error('Native module missing required function: generateShieldedAddress');
        }
        
        if (!nativeModule.validateAddress) {
            throw new Error('Native module missing required function: validateAddress');
        }
        
        console.log(`✅ ZCashSkills: Native module loaded successfully for ${platformKey}`);
        return nativeModule;
        
    } catch (error) {
        console.error(`❌ Failed to load native module: ${error.message}`);
        console.log('🔧 Attempting to build from source...');
        
        // Fallback to building from source
        return buildFromSource();
    }
}

/**
 * Build native module from source (fallback)
 * @returns {Object} Native module
 */
function buildFromSource() {
    const { execSync } = require('child_process');
    
    try {
        console.log('📥 Installing build dependencies...');
        execSync('npm install @neon-rs/cli', { 
            stdio: 'inherit',
            cwd: path.join(__dirname, '..')
        });
        
        console.log('🔨 Building native module from source...');
        execSync('npm run build', { 
            stdio: 'inherit',
            cwd: path.join(__dirname, '..')
        });
        
        console.log('✅ Build completed successfully');
        
        // Try loading the built module
        const builtModulePath = path.join(__dirname, '..', 'target', 'release', 'zcash-native.node');
        if (fs.existsSync(builtModulePath)) {
            return require(builtModulePath);
        } else {
            throw new Error('Built module not found at expected path');
        }
        
    } catch (buildError) {
        throw new Error(
            `❌ Both prebuilt binary and source build failed.\n\n` +
            `Platform: ${os.platform()}-${os.arch()}\n` +
            `Build error: ${buildError.message}\n\n` +
            `Troubleshooting:\n` +
            `1. Ensure Rust is installed: https://rustup.rs/\n` +
            `2. Ensure Node.js version is compatible (>=16)\n` +
            `3. Check build tools availability\n` +
            `4. Create an issue: https://github.com/konradgnat/zcashskills/issues`
        );
    }
}

// Load and export the native module
let nativeModule;

try {
    nativeModule = loadNativeModule();
} catch (error) {
    console.error('💥 ZCashSkills initialization failed:', error.message);
    throw error;
}

module.exports = nativeModule;