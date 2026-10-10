/* Use-After-Free: pointer dereferenced after free. */
int main() {
    char* p;
    p = malloc(16);
    free(p);
    *p = 65;
    return 0;
}
