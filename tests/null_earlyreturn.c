/* Safe control: early-return null guard proves p non-NULL afterwards. */
int main() {
    char* p;
    p = malloc(16);
    if (p == 0) {
        return 1;
    }
    *p = 65;
    free(p);
    return 0;
}
