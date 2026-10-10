/* Null-Pointer Dereference: malloc result dereferenced without a check. */
int main() {
    char* p;
    p = malloc(16);
    *p = 65;
    return 0;
}
