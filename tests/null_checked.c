/* Safe control: malloc result checked before dereference. */
int main() {
    char* p;
    p = malloc(16);
    if (p != 0) {
        *p = 65;
    }
    return 0;
}
