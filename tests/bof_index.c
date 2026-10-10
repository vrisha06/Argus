/* Buffer Overflow: tainted index written with no bounds check. */
int main() {
    char buf[16];
    int i;
    scanf("%d", &i);
    buf[i] = 65;
    return 0;
}
