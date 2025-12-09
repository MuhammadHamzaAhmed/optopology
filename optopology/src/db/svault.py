import base64


def get_pwd(input_hash):
    # First, check if the input looks like a plain text password
    # If it doesn't contain base64 characters or is too short for our encoding scheme, treat as plain text
    try:
        # Try to decode as base64
        base64_bytes = input_hash.encode()
        sample_string_bytes = base64.b64decode(base64_bytes)
        sample_string = sample_string_bytes.decode()

        # Check if this follows our expected encoding pattern (length > 12)
        if len(sample_string) > 12:
            cipher_string = sample_string[12:]
            cipher_bytes = cipher_string.encode()
            cipher_string_bytes = base64.b64decode(cipher_bytes)
            cipher_string = cipher_string_bytes.decode()
            return cipher_string
        else:
            # If decoded but doesn't match pattern, treat as plain text
            return input_hash
            
    except Exception:
        # If base64 decoding fails, treat as plain text password
        return input_hash

    # Fallback: return as plain text
    return input_hash
