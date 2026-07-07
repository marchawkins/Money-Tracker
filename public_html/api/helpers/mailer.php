<?php
class Mailer {
    public static function send(string $to, string $subject, string $body): bool {
        // Prevent header injection
        $to      = str_replace(["\r", "\n"], '', $to);
        $subject = str_replace(["\r", "\n"], '', $subject);

        $fromName  = defined('MAIL_FROM_NAME') ? MAIL_FROM_NAME : 'Money';
        $fromEmail = defined('MAIL_FROM')
            ? MAIL_FROM
            : 'noreply@' . ($_SERVER['HTTP_HOST'] ?? 'localhost');

        $headers = implode("\r\n", [
            'From: ' . $fromName . ' <' . $fromEmail . '>',
            'Content-Type: text/plain; charset=UTF-8',
            'MIME-Version: 1.0',
        ]);

        return mail($to, $subject, $body, $headers);
    }
}
