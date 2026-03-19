/**
 * OpenClaw ZCash Privacy Agent Example
 * 
 * Demonstrates how to integrate zcashskills into an OpenClaw agent
 * for privacy-preserving cryptocurrency operations.
 */

const zcashSkills = require('zcashskills');

class ZCashPrivacyAgent {
    constructor(options = {}) {
        this.defaultNetwork = options.network || 'mainnet';
        this.verbose = options.verbose || false;
    }

    /**
     * Generate a private address for the specified network
     */
    async generatePrivateAddress(network = this.defaultNetwork) {
        try {
            const result = await zcashSkills.generateAddress({ network });
            
            if (result.success) {
                const message = 
                    `🔐 **Generated Private ${network.toUpperCase()} Address**\n\n` +
                    `**Address:** \`${result.address}\`\n` +
                    `**Network:** ${result.network}\n` +
                    `**Type:** ${result.type} (privacy-preserving)\n` +
                    `**Generated:** ${new Date(result.timestamp).toLocaleString()}\n\n` +
                    `✅ Generated locally using librustzcash - your private keys never left this server!`;
                
                if (this.verbose) {
                    console.log(`Generated ${network} address:`, result.address);
                }
                
                return message;
            } else {
                return `❌ **Failed to generate address:** ${result.error}`;
            }
        } catch (error) {
            return `💥 **Error:** ${error.message}`;
        }
    }

    /**
     * Create a payment request with specified parameters
     */
    async createPaymentRequest(address, amount, memo, label) {
        try {
            // First validate the address
            const validation = await zcashSkills.validateAddress({ address });
            
            if (!validation.valid) {
                return `❌ **Invalid Address:** ${address}\n\nPlease provide a valid ZCash address.`;
            }

            // Create payment URI
            const uriResult = await zcashSkills.createPaymentUri({ 
                address, 
                amount, 
                memo, 
                label 
            });
            
            if (uriResult.success) {
                const message =
                    `💳 **Payment Request Created**\n\n` +
                    `**To:** ${zcashSkills.truncateAddress ? zcashSkills.truncateAddress(address, 30) : address}\n` +
                    `**Network:** ${validation.network}\n` +
                    `**Type:** ${validation.type}\n` +
                    (amount ? `**Amount:** ${amount} ZEC\n` : '') +
                    (memo ? `**Memo:** ${memo}\n` : '') +
                    (label ? `**Label:** ${label}\n` : '') +
                    `\n**Payment URI:**\n\`${uriResult.uri}\`\n\n` +
                    `📱 Share this URI or convert to QR code for easy payments!`;
                
                if (this.verbose) {
                    console.log('Payment URI created:', uriResult.uri);
                }
                
                return message;
            } else {
                return `❌ **Failed to create payment request:** ${uriResult.error}`;
            }
        } catch (error) {
            return `💥 **Error:** ${error.message}`;
        }
    }

    /**
     * Validate and analyze a ZCash address
     */
    async validateAndAnalyzeAddress(address) {
        try {
            const result = await zcashSkills.validateAddress({ address });
            
            if (result.valid) {
                let analysis = 
                    `✅ **Valid ZCash Address**\n\n` +
                    `**Address:** \`${address}\`\n` +
                    `**Network:** ${result.network}\n` +
                    `**Type:** ${result.type}\n\n`;
                
                // Add recommendations based on address type
                if (result.recommendations && result.recommendations.length > 0) {
                    analysis += `**Recommendations:**\n`;
                    result.recommendations.forEach(rec => {
                        analysis += `• ${rec}\n`;
                    });
                }
                
                // Add privacy analysis
                if (result.type === 'shielded') {
                    analysis += `\n🔒 **Privacy Level:** Maximum\n` +
                               `This address supports fully private transactions where amounts and participants are hidden.`;
                } else if (result.type === 'transparent') {
                    analysis += `\n⚠️ **Privacy Level:** None\n` +
                               `This address is transparent - all transactions are visible on the blockchain.`;
                } else if (result.type === 'unified') {
                    analysis += `\n🔄 **Privacy Level:** Flexible\n` +
                               `This unified address supports multiple privacy levels and future protocols.`;
                }
                
                return analysis;
            } else {
                return `❌ **Invalid ZCash Address**\n\n` +
                       `**Address:** \`${address}\`\n\n` +
                       `**Suggestions:**\n` +
                       `• Check the address was copied correctly\n` +
                       `• Ensure it's a ZCash address (not Bitcoin/Ethereum)\n` +
                       `• Verify there are no extra spaces or characters`;
            }
        } catch (error) {
            return `💥 **Error:** ${error.message}`;
        }
    }

    /**
     * Parse a payment URI and display information
     */
    async parsePaymentUri(uri) {
        try {
            const result = await zcashSkills.parsePaymentUri({ uri });
            
            if (result.success) {
                let info = 
                    `📋 **Payment URI Details**\n\n` +
                    `**To Address:** \`${result.parsed.address}\`\n` +
                    `**Network:** ${result.addressInfo.network}\n` +
                    `**Address Type:** ${result.addressInfo.type}\n`;
                
                if (result.parsed.amount) {
                    info += `**Amount:** ${result.parsed.amount} ZEC\n`;
                }
                
                if (result.parsed.memo) {
                    info += `**Memo:** ${result.parsed.memo}\n`;
                }
                
                if (result.parsed.label) {
                    info += `**Label:** ${result.parsed.label}\n`;
                }
                
                if (result.parsed.message) {
                    info += `**Message:** ${result.parsed.message}\n`;
                }
                
                info += `\n✅ This payment URI follows the ZIP-321 standard and is ready for processing.`;
                
                return info;
            } else {
                return `❌ **Invalid Payment URI:** ${result.error}`;
            }
        } catch (error) {
            return `💥 **Error:** ${error.message}`;
        }
    }

    /**
     * Setup privacy payments (generate addresses for both networks)
     */
    async setupPrivacyPayments() {
        try {
            const testnet = await zcashSkills.generateAddress({ network: 'testnet' });
            const mainnet = await zcashSkills.generateAddress({ network: 'mainnet' });
            
            if (testnet.success && mainnet.success) {
                return `🔐 **Privacy Payment Setup Complete**\n\n` +
                       `**🧪 Testnet Address (for testing):**\n\`${testnet.address}\`\n\n` +
                       `**🌍 Mainnet Address (for production):**\n\`${mainnet.address}\`\n\n` +
                       `✅ Both addresses generated locally with librustzcash\n` +
                       `🔒 Your private keys are secure and never left this server\n\n` +
                       `**Next Steps:**\n` +
                       `• Save these addresses securely\n` +
                       `• Use testnet for development and testing\n` +
                       `• Use mainnet for real transactions\n` +
                       `• Create payment URIs as needed`;
            }
            
            return `❌ **Setup failed:** Unable to generate addresses`;
        } catch (error) {
            return `💥 **Setup error:** ${error.message}`;
        }
    }

    /**
     * Get skill information and capabilities
     */
    getCapabilities() {
        return `🛠️ **ZCash Privacy Agent Capabilities**\n\n` +
               `**Available Commands:**\n` +
               `• \`generatePrivateAddress(network)\` - Generate shielded addresses\n` +
               `• \`createPaymentRequest(address, amount, memo, label)\` - Create payment URIs\n` +
               `• \`validateAndAnalyzeAddress(address)\` - Validate and analyze addresses\n` +
               `• \`parsePaymentUri(uri)\` - Parse ZIP-321 payment URIs\n` +
               `• \`setupPrivacyPayments()\` - Generate testnet and mainnet addresses\n\n` +
               `**Privacy Features:**\n` +
               `• 🔐 Local cryptographic operations using librustzcash\n` +
               `• 🚫 No external API calls for sensitive operations\n` +
               `• 🔒 Shielded addresses provide maximum privacy\n` +
               `• 📱 ZIP-321 standard payment URIs\n` +
               `• ⚡ Cross-platform native performance\n\n` +
               `**Supported Networks:** mainnet, testnet\n` +
               `**Library Version:** ${require('zcashskills/package.json').version}`;
    }
}

// Export for OpenClaw agent usage
module.exports = ZCashPrivacyAgent;

// Example usage
if (require.main === module) {
    const agent = new ZCashPrivacyAgent({ verbose: true });
    
    async function demo() {
        console.log('🚀 ZCash Privacy Agent Demo\n');
        
        // Generate testnet address
        const address = await agent.generatePrivateAddress('testnet');
        console.log(address);
        
        // Create payment request
        const payment = await agent.createPaymentRequest(
            'ztestsapling1abc123...', // Replace with real address
            0.001,
            'Demo payment',
            'Agent Demo'
        );
        console.log('\n' + payment);
    }
    
    // demo().catch(console.error);
}