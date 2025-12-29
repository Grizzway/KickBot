module.exports = {
  kickGifts: {
    // Default conversion rate: 1 Kick = 1 Token
    defaultRate: 1,
    
    // You can add specific rates for different gift types if needed
    // Example:
    // giftRates: {
    //   "Full Send": 1.5,  // 100 kicks = 150 tokens
    //   "Hype": 1.2,       // 10 kicks = 12 tokens
    //   "Hell Yeah": 1     // 1 kick = 1 token
    // }
  },
  
  messages: {
    giftConfirmation: "@{username} Thank you for the {giftName}! You earned {tokens} tokens! Balance: {balance}",
    giftTooSmall: "@{username} Thank you for the {giftName}! (Gift too small for tokens)",
    giftError: "@{username} There was an error processing your gift."
  },
  
  processing: {
    minimumKicks: 1,
    maxProcessedGifts: 1000
  }
};