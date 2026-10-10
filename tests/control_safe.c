/* Safe control: no untrusted input, bounded buffers, checked allocation. */
int add(int a, int b) {
    return a + b;
}
int main() {
    int x;
    int y;
    char* p;
    x = 2;
    y = add(x, 3);
    p = malloc(16);
    if (p != 0) {
        *p = 65;
        free(p);
    }
    return y;
}
