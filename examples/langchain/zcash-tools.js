/**
 * LangChain ZCash Tools Integration
 * 
 * Provides ZCash skills as LangChain DynamicTool instances
 * for integration with LangChain agents and chains.
 */

const { DynamicTool } = require('langchain/tools');
const zcashSkills = require('zcashskills');

/**
 * Generate ZCash Address Tool
 */
const generateZcashAddressTool = new DynamicTool({
    name: "generate-zcash-address",
    description: "Generate a new ZCash shielded address for privacy-preserving payments. " +
                "Input should be a JSON object with optional 'network' field ('mainnet' or 'testnet'). " +
                "Example: {\"network\": \"testnet\"}",
    func: async (input) => {
        try {
            const params = input ? JSON.parse(input) : {};
            const { network = 'mainnet' } = params;
            
            const result = await zcashSkills.generateAddress({ network });
            
            if (result.success) {
                return `Successfully generated ${network} address: ${result.address}. ` +
                       `Type: ${result.type}. Generated locally using librustzcash.`;
            } else {
                return `Failed to generate address: ${result.error}`;
            }
        } catch (error) {
            return `Error generating address: ${error.message}`;
        }
    }
});

/**
 * Validate ZCash Address Tool
 */
const validateZcashAddressTool = new DynamicTool({
    name: "validate-zcash-address",
    description: "Validate a ZCash address and get network/type information. " +
                "Input should be a JSON object with 'address' field. " +
                "Example: {\"address\": \"ztestsapling1abc123...\"}",
    func: async (input) => {
        try {
            const params = JSON.parse(input);
            const { address } = params;
            
            if (!address) {
                return "Error: Address field is required";
            }
            
            const result = await zcashSkills.validateAddress({ address });
            
            if (result.success && result.valid) {
                return `Valid ${result.type} address on ${result.network}. ` +
                       `Recommendations: ${result.recommendations?.join(', ') || 'None'}`;
            } else if (result.success && !result.valid) {
                return `Invalid ZCash address format. Please check the address and try again.`;
            } else {
                return `Validation error: ${result.error}`;
            }
        } catch (error) {
            return `Error validating address: ${error.message}`;
        }
    }
});

/**
 * Create ZCash Payment URI Tool
 */
const createZcashPaymentUriTool = new DynamicTool({
    name: "create-zcash-payment-uri",
    description: "Create a ZIP-321 ZCash payment URI for requesting payments. " +
                "Input should be a JSON object with 'address' (required) and optional 'amount', 'memo', 'label' fields. " +
                "Example: {\"address\": \"ztestsapling1abc123...\", \"amount\": 0.001, \"memo\": \"Coffee payment\"}",
    func: async (input) => {
        try {
            const params = JSON.parse(input);
            const { address, amount, memo, label } = params;
            
            if (!address) {
                return "Error: Address field is required";
            }
            
            const result = await zcashSkills.createPaymentUri({ 
                address, 
                amount, 
                memo, 
                label 
            });
            
            if (result.success) {
                let response = `Payment URI created: ${result.uri}`;
                
                if (result.addressInfo) {
                    response += ` (${result.addressInfo.type} address on ${result.addressInfo.network})`;
                }
                
                return response;
            } else {
                return `Failed to create payment URI: ${result.error}`;
            }
        } catch (error) {
            return `Error creating payment URI: ${error.message}`;
        }
    }
});

/**
 * Parse ZCash Payment URI Tool
 */
const parseZcashPaymentUriTool = new DynamicTool({
    name: "parse-zcash-payment-uri",
    description: "Parse a ZIP-321 ZCash payment URI to extract payment details. " +
                "Input should be a JSON object with 'uri' field. " +
                "Example: {\"uri\": \"zcash:ztestsapling1abc123...?amount=0.001&memo=Coffee\"}",
    func: async (input) => {
        try {
            const params = JSON.parse(input);
            const { uri } = params;
            
            if (!uri) {
                return "Error: URI field is required";
            }
            
            const result = await zcashSkills.parsePaymentUri({ uri });
            
            if (result.success) {
                const parsed = result.parsed;
                let response = `Parsed payment URI - `;
                response += `Address: ${parsed.address}`;
                
                if (parsed.amount) response += `, Amount: ${parsed.amount} ZEC`;
                if (parsed.memo) response += `, Memo: "${parsed.memo}"`;
                if (parsed.label) response += `, Label: "${parsed.label}"`;
                
                if (result.addressInfo) {
                    response += ` (${result.addressInfo.type} address on ${result.addressInfo.network})`;
                }
                
                return response;
            } else {
                return `Failed to parse payment URI: ${result.error}`;
            }
        } catch (error) {
            return `Error parsing payment URI: ${error.message}`;
        }
    }
});

/**
 * ZCash Privacy Setup Tool
 */
const zcashPrivacySetupTool = new DynamicTool({
    name: "zcash-privacy-setup",
    description: "Generate both testnet and mainnet ZCash addresses for privacy payments. " +
                "No input required - generates addresses for both networks.",
    func: async (input) => {
        try {
            const testnet = await zcashSkills.generateAddress({ network: 'testnet' });
            const mainnet = await zcashSkills.generateAddress({ network: 'mainnet' });
            
            if (testnet.success && mainnet.success) {
                return `Privacy setup complete! ` +
                       `Testnet address: ${testnet.address}. ` +
                       `Mainnet address: ${mainnet.address}. ` +
                       `Both generated locally using librustzcash.`;
            } else {
                const errors = [];
                if (!testnet.success) errors.push(`Testnet: ${testnet.error}`);
                if (!mainnet.success) errors.push(`Mainnet: ${mainnet.error}`);
                return `Setup failed: ${errors.join(', ')}`;
            }
        } catch (error) {
            return `Error during privacy setup: ${error.message}`;
        }
    }
});

/**
 * Export all tools for LangChain integration
 */
const zcashTools = [
    generateZcashAddressTool,
    validateZcashAddressTool,
    createZcashPaymentUriTool,
    parseZcashPaymentUriTool,
    zcashPrivacySetupTool
];

module.exports = {
    zcashTools,
    generateZcashAddressTool,
    validateZcashAddressTool,
    createZcashPaymentUriTool,
    parseZcashPaymentUriTool,
    zcashPrivacySetupTool
};

// Example usage with LangChain
if (require.main === module) {
    const { ChatOpenAI } = require('langchain/chat_models/openai');
    const { AgentExecutor, createOpenAIToolsAgent } = require('langchain/agents');
    const { ChatPromptTemplate } = require('langchain/core/prompts');
    
    async function demo() {
        console.log('🚀 LangChain ZCash Tools Demo\n');
        
        // Test individual tools
        console.log('Testing address generation...');
        const generateResult = await generateZcashAddressTool.func('{"network": "testnet"}');
        console.log(generateResult);
        
        console.log('\nTesting address validation...');
        const validateResult = await validateZcashAddressTool.func('{"address": "invalid-address"}');
        console.log(validateResult);
        
        console.log('\nTesting payment URI creation...');
        const uriResult = await createZcashPaymentUriTool.func('{"address": "ztestsapling1abc123", "amount": 0.001, "memo": "Test payment"}');
        console.log(uriResult);
    }
    
    // demo().catch(console.error);
}