/* Safe control: pointer reassigned to a fresh, checked allocation before use. */
int main() {
    char* p;
    p = malloc(16);
    free(p);
    p = malloc(16);
    if (p != 0) {
        *p = 65;
    }
    free(p);
    return 0;
}
