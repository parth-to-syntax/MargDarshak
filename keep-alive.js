const pingWebsite = async () => {
  // Pinging the health endpoint instead of login
  const url = 'https://margdarshak-evyx.onrender.com/health'; 
  
  try {
    const response = await fetch(url); // Simple GET request

    if (response.ok) {
      console.log(`[${new Date().toISOString()}] Successfully pinged ${url}! Status: ${response.status}`);
    } else {
      console.error(`[${new Date().toISOString()}] Ping failed with status: ${response.status}`);
    }
  } catch (error) {
    console.error('Error connecting to website:', error.message);
  }
};

pingWebsite();
