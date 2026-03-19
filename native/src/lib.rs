/**
 * ZCash Skills Native Module
 * 
 * Rust implementation providing ZCash cryptographic operations
 * via librustzcash for the Node.js zcashskills package.
 */

use neon::prelude::*;
use zcash_keys::keys::UnifiedSpendingKey;
use zcash_address::{Network, ZcashAddress};
use rand::rngs::OsRng;

/// Generate a new ZCash shielded address using librustzcash
/// 
/// This function creates a new unified spending key, derives the
/// full viewing key, and extracts the default Sapling address.
/// 
/// # Arguments
/// * `network` - Target network ("mainnet" or "testnet")
/// 
/// # Returns
/// JavaScript object with address, network, and type information
fn generate_shielded_address(mut cx: FunctionContext) -> JsResult<JsObject> {
    // Parse network parameter from JavaScript
    let network_str = cx.argument::<JsString>(0)?.value(&mut cx);
    
    // Convert string to Network enum
    let network = match network_str.as_str() {
        "testnet" => Network::TestNetwork,
        "mainnet" => Network::MainNetwork,
        _ => {
            // Return error for invalid network
            return cx.throw_error("Invalid network. Use 'mainnet' or 'testnet'");
        }
    };

    // Generate cryptographically secure random spending key
    let mut rng = OsRng;  // OS-provided cryptographic randomness
    let spending_key = UnifiedSpendingKey::generate(&mut rng);
    
    // Derive full viewing key from spending key
    let fvk = spending_key.to_unified_full_viewing_key();
    
    // Extract Sapling component and get default address
    let sapling_fvk = match fvk.sapling() {
        Some(fvk) => fvk,
        None => {
            return cx.throw_error("Failed to derive Sapling component from spending key");
        }
    };
    
    // Get the default Sapling address
    let (_, payment_address) = sapling_fvk.default_address();
    
    // Encode address for the specified network
    let address_encoded = payment_address.encode(&network);

    // Create JavaScript object to return
    let result = cx.empty_object();
    
    // Set address field
    let js_address = cx.string(address_encoded);
    result.set(&mut cx, "address", js_address)?;
    
    // Set network field
    let js_network = cx.string(network_str);
    result.set(&mut cx, "network", js_network)?;
    
    // Set type field (always shielded for this function)
    let js_type = cx.string("shielded");
    result.set(&mut cx, "type", js_type)?;
    
    // Set derivation path (standard ZCash derivation)
    let js_path = cx.string("m/32'/133'/0'");
    result.set(&mut cx, "derivation_path", js_path)?;

    Ok(result)
}

/// Validate a ZCash address and extract network/type information
/// 
/// # Arguments  
/// * `address` - Address string to validate
/// 
/// # Returns
/// JavaScript object with validation result and address info
fn validate_address(mut cx: FunctionContext) -> JsResult<JsObject> {
    let address_str = cx.argument::<JsString>(0)?.value(&mut cx);
    let result = cx.empty_object();
    
    match ZcashAddress::try_from_encoded(&address_str) {
        Ok(address) => {
            // Address is valid, extract information
            result.set(&mut cx, "valid", cx.boolean(true))?;
            
            // Determine network
            let network = match address.network() {
                Network::MainNetwork => "mainnet",
                Network::TestNetwork => "testnet",
            };
            result.set(&mut cx, "network", cx.string(network))?;
            
            // Determine address type
            let addr_type = match address {
                ZcashAddress::Sapling(_) => "shielded",
                ZcashAddress::Unified(_) => "unified", 
                ZcashAddress::Transparent(_) => "transparent",
            };
            result.set(&mut cx, "type", cx.string(addr_type))?;
        }
        Err(_) => {
            // Address is invalid
            result.set(&mut cx, "valid", cx.boolean(false))?;
        }
    }

    Ok(result)
}

/// Export functions to Node.js
/// 
/// This registers all available functions that can be called
/// from JavaScript code.
#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    // Export address generation function
    cx.export_function("generateShieldedAddress", generate_shielded_address)?;
    
    // Export address validation function  
    cx.export_function("validateAddress", validate_address)?;
    
    Ok(())
}