import { linkWhatsApp } from './wa-linker';

async function debugPairing() {
  try {
    console.log('Debugging WhatsApp pairing...');
    
    const phoneNumber = '+16107577306';
    console.log(`Testing with phone number: ${phoneNumber}`);
    
    const result = await linkWhatsApp(phoneNumber);
    console.log('Result:', result);
    
  } catch (error) {
    console.error('Debug error:', error);
  }
}

debugPairing().catch(console.error);

