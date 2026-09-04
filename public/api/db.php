<?php
mb_internal_encoding("UTF-8");

// Polyfill PHP 7.4 (hosting sin PHP 8)
if (!function_exists('str_contains')) {
    function str_contains($haystack, $needle) {
        return $needle === '' || strpos((string)$haystack, (string)$needle) !== false;
    }
}

// Conexión MySQL centralizada — todos los PHP de la API lo incluyen
define('DB_HOST', 'localhost');
define('DB_PORT', 3306);
define('DB_NAME', 'qmfqbfes_dashboard');
define('DB_USER', 'qmfqbfes_leo');
define('DB_PASS', 'Yuganl0vetaco$');
define('DB_CHARSET', 'utf8mb4');


function get_db(): PDO {
    static $pdo = null;
    if ($pdo !== null) return $pdo;
    $dsn = 'mysql:host=' . DB_HOST . ';port=' . DB_PORT
         . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET;
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
    return $pdo;
}
