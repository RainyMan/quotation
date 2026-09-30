<?php
// Copy to the directory ABOVE public_html as quotation-analytics-config.php.
// Do not place real credentials or the SQLite database in the public repository.
return [
    'origin' => 'https://q.tarmacroad.com',
    'pocketbase' => 'https://pocketbase.tarmacroad.com',
    'password_hash' => '', // Generate with password_hash; never put a plaintext password here.
    'database' => __DIR__.'/quotation-analytics-data/analytics.sqlite',
    'retention_days' => 90,
    // City lookup sends the visitor IP to https://ipwho.is, with 24-hour caching.
    // Use '' to disable external lookup; locations will show unknown.
    'geolocation' => 'ipwho.is',
    // Leave empty if REMOTE_ADDR already contains the visitor IP.
    // Only add exact proxy IPs verified by Cloudways, never an arbitrary public IP.
    'trusted_proxies' => [],
    'client_ip_header' => 'HTTP_CF_CONNECTING_IP',
];
