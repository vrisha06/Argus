/* Use-After-Free: double free of the same allocation. */
int main() {
    char* p;
    p = malloc(16);
    free(p);
    free(p);
    return 0;
}
